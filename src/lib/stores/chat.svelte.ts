import { api, withRetry } from '$lib/client/api';
import { readJSON, writeJSON } from '$lib/client/storage';
import { ApiError, AppErrorCode } from '$lib/errors';
import { newSSEState, parseSSEChunk } from '$lib/sse';
import { emptyAssistant, groupTranscript, uid, type UiMessage } from '$lib/transcript';
import { toasts } from './toast.svelte';
import type {
	Attachment,
	ContentPart,
	HermesMessage,
	HermesSession,
	ModelOptions,
	StatusPayload,
	ToolStep
} from '$lib/types';

/** What the last turn was, so "Renvoyer" can replay it verbatim. */
interface LastPrompt {
	text: string;
	attachments: Attachment[];
}

class ChatStore {
	sessions = $state<HermesSession[]>([]);
	sessionId = $state<string | null>(null);
	messages = $state<UiMessage[]>([]);
	streaming = $state(false);
	/** True after stop(): a turn is still running server-side, unwatched. */
	detached = $state(false);
	loadingHistory = $state(false);
	loadingSessions = $state(false);

	/** null while unknown, then true/false. Drives the offline banner. */
	connected = $state<boolean | null>(null);
	version = $state('');
	status = $state<StatusPayload | null>(null);

	models = $state<ModelOptions | null>(null);
	/** Model for the NEXT new session — Hermes pins it per session row. */
	nextModel = $state('');
	skills = $state<Array<{ name: string; description?: string }>>([]);
	toolCount = $state(0);
	mcpTools = $state<string[]>([]);

	#abort: AbortController | null = null;
	#lastPrompt: LastPrompt | null = null;
	#healthTimer: ReturnType<typeof setTimeout> | null = null;
	#healthBackoff = 0;

	get current(): HermesSession | undefined {
		return this.sessions.find((s) => s.id === this.sessionId);
	}

	get canResend(): boolean {
		return !this.streaming && this.#lastPrompt !== null;
	}

	// -- bootstrap ----------------------------------------------------------

	async init() {
		this.nextModel = readJSON('hermes-next-model', '');
		await Promise.allSettled([this.refreshHealth(), this.refreshSessions(), this.refreshCatalog()]);
		this.#scheduleHealth();
	}

	dispose() {
		if (this.#healthTimer) clearTimeout(this.#healthTimer);
		this.#healthTimer = null;
	}

	/**
	 * Poll health so the UI notices the gateway coming back on its own.
	 *
	 * Fast while down (the user is probably restarting it and wants to see the
	 * banner clear), slow while up — this runs on a Pi and the check walks the
	 * gateway's runtime state.
	 */
	#scheduleHealth() {
		if (this.#healthTimer) clearTimeout(this.#healthTimer);
		const delay = this.connected === false ? Math.min(3000 * 2 ** this.#healthBackoff, 30_000) : 60_000;
		this.#healthTimer = setTimeout(async () => {
			await this.refreshHealth();
			this.#scheduleHealth();
		}, delay);
	}

	async refreshHealth() {
		const wasConnected = this.connected;
		try {
			const res = await api<{ health: { version: string } }>('/api/capabilities', {
				timeoutMs: 8000
			});
			this.connected = true;
			this.#healthBackoff = 0;
			this.version = res.health?.version ?? '';
			if (wasConnected === false) {
				toasts.success('Connexion à Hermes rétablie.');
				// State may have moved on while we were blind.
				this.refreshSessions();
				this.refreshCatalog();
			}
		} catch {
			this.connected = false;
			this.#healthBackoff = Math.min(this.#healthBackoff + 1, 4);
		}
	}

	async refreshStatus() {
		try {
			this.status = await api<StatusPayload>('/api/status', { timeoutMs: 15_000 });
		} catch (err) {
			toasts.error(err);
		}
	}

	async refreshCatalog() {
		try {
			this.models = await withRetry(() => api<ModelOptions>('/api/models'));
			// A model saved from a previous session may no longer be offered.
			const known = new Set(this.models.providers.flatMap((p) => p.models));
			if (!this.nextModel || !known.has(this.nextModel)) this.nextModel = this.models.model;
		} catch {
			/* the picker stays empty; chat still works on the server default */
		}
		try {
			const res = await api<{
				skills: Array<{ name: string; description?: string }>;
				toolsets: Array<{ tools?: string[]; enabled?: boolean }>;
			}>('/api/skills');
			this.skills = res.skills ?? [];
			const tools = (res.toolsets ?? []).filter((t) => t.enabled !== false).flatMap((t) => t.tools ?? []);
			this.toolCount = new Set(tools).size;
			this.mcpTools = [...new Set(tools.filter((t) => t.startsWith('mcp_')))];
		} catch {
			/* skills palette unavailable — not fatal */
		}
	}

	async refreshSessions() {
		this.loadingSessions = true;
		try {
			const res = await withRetry(() =>
				api<{ data: HermesSession[] }>('/api/sessions?limit=200')
			);
			this.sessions = res.data ?? [];
		} catch (err) {
			toasts.error(err, { label: 'Réessayer', run: () => this.refreshSessions() });
		} finally {
			this.loadingSessions = false;
		}
	}

	setModel(model: string) {
		this.nextModel = model;
		writeJSON('hermes-next-model', model);
	}

	// -- session lifecycle --------------------------------------------------

	async newSession(title?: string): Promise<string | null> {
		try {
			const res = await api<{ session: HermesSession }>('/api/sessions', {
				method: 'POST',
				body: JSON.stringify({ title, model: this.nextModel || undefined })
			});
			this.sessions = [res.session, ...this.sessions];
			this.sessionId = res.session.id;
			this.messages = [];
			this.detached = false;
			return res.session.id;
		} catch (err) {
			toasts.error(err);
			return null;
		}
	}

	async openSession(id: string) {
		if (this.streaming) this.stop();
		this.sessionId = id;
		this.messages = [];
		this.detached = false;
		this.loadingHistory = true;
		try {
			const res = await withRetry(() =>
				api<{ data: HermesMessage[] }>(
					`/api/sessions/${encodeURIComponent(id)}/messages?order=oldest&limit=500`
				)
			);
			this.messages = groupTranscript(res.data ?? []);
		} catch (err) {
			if (err instanceof ApiError && err.code === AppErrorCode.SessionGone) {
				// Deleted from the CLI, Telegram, or another tab. Re-sync
				// rather than leaving a ghost row in the sidebar.
				this.sessions = this.sessions.filter((s) => s.id !== id);
				this.sessionId = null;
				toasts.info("Cette conversation n'existe plus.");
			} else {
				toasts.error(err, { label: 'Réessayer', run: () => this.openSession(id) });
			}
		} finally {
			this.loadingHistory = false;
		}
	}

	/** Re-read the transcript from Hermes — used after detaching from a turn. */
	async reload() {
		if (!this.sessionId) return;
		this.detached = false;
		await Promise.all([this.openSession(this.sessionId), this.refreshSessions()]);
	}

	async renameSession(id: string, title: string) {
		const previous = this.sessions.find((s) => s.id === id)?.title;
		this.#patchLocal(id, { title });
		try {
			await api(`/api/sessions/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				body: JSON.stringify({ title })
			});
		} catch (err) {
			this.#patchLocal(id, { title: previous ?? null });
			toasts.error(err);
		}
	}

	async togglePin(id: string) {
		const session = this.sessions.find((s) => s.id === id);
		if (!session) return;
		const pinned = !session.pinned;
		this.#patchLocal(id, { pinned });
		try {
			await api(`/api/sessions/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				body: JSON.stringify({ pinned })
			});
		} catch (err) {
			this.#patchLocal(id, { pinned: !pinned });
			toasts.error(err);
		}
	}

	async toggleArchive(id: string) {
		const session = this.sessions.find((s) => s.id === id);
		if (!session) return;
		const archived = !session.archived;
		this.#patchLocal(id, { archived });
		try {
			await api(`/api/sessions/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				body: JSON.stringify({ archived })
			});
			toasts.success(archived ? 'Conversation archivée.' : 'Conversation désarchivée.');
		} catch (err) {
			this.#patchLocal(id, { archived: !archived });
			toasts.error(err);
		}
	}

	async deleteSession(id: string) {
		const snapshot = this.sessions;
		this.sessions = this.sessions.filter((s) => s.id !== id);
		if (this.sessionId === id) {
			this.sessionId = null;
			this.messages = [];
		}
		try {
			await api(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
		} catch (err) {
			// A 404 means it was already gone — the optimistic removal was right.
			if (err instanceof ApiError && err.code === AppErrorCode.SessionGone) return;
			this.sessions = snapshot;
			toasts.error(err);
		}
	}

	/** Branch the current conversation. Hermes closes the parent as
	 *  "branched", so both rows are refreshed from the server afterwards. */
	async forkSession(id: string) {
		try {
			const res = await api<{ session: HermesSession }>(
				`/api/sessions/${encodeURIComponent(id)}/fork`,
				{ method: 'POST', body: JSON.stringify({}) }
			);
			await this.refreshSessions();
			await this.openSession(res.session.id);
			toasts.success('Branche créée.');
		} catch (err) {
			toasts.error(err);
		}
	}

	#patchLocal(id: string, patch: Partial<HermesSession>) {
		this.sessions = this.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s));
	}

	// -- the turn -----------------------------------------------------------

	/**
	 * Detach from the running turn.
	 *
	 * This does NOT interrupt the agent, and cannot: the Sessions API has no
	 * stop endpoint (`/v1/runs/{id}/stop` only knows runs submitted through
	 * `POST /v1/runs`), and dropping the SSE connection does not cancel the
	 * run either — measured: a turn aborted after 6 s still ran its tools and
	 * persisted its answer ~25 s later.
	 *
	 * So we stop rendering, flag the turn as detached, and tell the user the
	 * answer will land in the transcript. `reload()` fetches it.
	 */
	stop() {
		this.#abort?.abort();
		this.#abort = null;
		this.streaming = false;
		this.detached = true;
		const last = this.messages.at(-1);
		if (last?.streaming) {
			last.streaming = false;
			last.detached = true;
			for (const step of last.steps) if (step.status === 'running') step.status = 'done';
		}
	}

	/** Re-send the previous prompt as a new turn. */
	async resend() {
		if (!this.#lastPrompt || this.streaming) return;
		const { text, attachments } = this.#lastPrompt;
		await this.send(text, attachments);
	}

	async send(text: string, attachments: Attachment[] = []) {
		if (this.streaming) return;
		const trimmed = text.trim();
		if (!trimmed && attachments.length === 0) return;

		this.detached = false;
		this.#lastPrompt = { text, attachments };

		let id = this.sessionId;
		if (!id) {
			id = await this.newSession(titleFrom(trimmed));
			if (!id) return;
		}

		// Hermes accepts a plain string or an OpenAI-style content array.
		// Only images are allowed: non-image data: URLs and file/file_id parts
		// are rejected with 400 unsupported_content_type.
		const payload: string | ContentPart[] = attachments.length
			? [
					...attachments.map<ContentPart>((a) => ({
						type: 'image_url',
						image_url: { url: a.dataUrl }
					})),
					{ type: 'text', text: trimmed }
				]
			: trimmed;

		this.messages.push({
			id: uid('u'),
			role: 'user',
			content: trimmed,
			images: attachments.map((a) => a.dataUrl),
			steps: [],
			reasoning: '',
			streaming: false,
			timestamp: Date.now() / 1000
		});
		this.messages.push(emptyAssistant());
		// Read the pushed element back: $state hands out a proxy, and only
		// mutations through that proxy are reactive.
		const assistant = this.messages[this.messages.length - 1];

		this.streaming = true;
		this.#abort = new AbortController();

		try {
			const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/stream`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: payload }),
				signal: this.#abort.signal
			});
			if (!res.body) throw new Error('Réponse sans corps.');
			await this.#consume(res.body, assistant);
		} catch (err) {
			if ((err as Error)?.name !== 'AbortError') {
				assistant.error = err instanceof Error ? err.message : String(err);
				// Losing the socket mid-turn does not stop the agent, so the
				// answer is probably still coming — offer to fetch it.
				toasts.push('error', 'La connexion au flux a été perdue.', {
					action: { label: 'Recharger', run: () => this.reload() }
				});
				this.connected = false;
				this.#scheduleHealth();
			}
		} finally {
			assistant.streaming = false;
			this.streaming = false;
			this.#abort = null;
			// message_count / preview / last_active only change server-side.
			this.refreshSessions();
		}
	}

	async #consume(body: ReadableStream<Uint8Array>, assistant: UiMessage) {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		const state = newSSEState();

		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			for (const frame of parseSSEChunk(state, decoder.decode(value, { stream: true }))) {
				let data: Record<string, any>;
				try {
					data = JSON.parse(frame.data);
				} catch {
					continue; // a malformed frame must not kill the stream
				}
				this.#applyEvent(frame.event, data, assistant);
				if (frame.event === 'done') return;
			}
		}
	}

	#applyEvent(event: string, data: Record<string, any>, assistant: UiMessage) {
		switch (event) {
			case 'assistant.delta':
				assistant.content += data.delta ?? '';
				break;

			case 'tool.progress':
				// Emitted for reasoning.available with tool_name "_thinking".
				if (data.tool_name === '_thinking') assistant.reasoning += data.delta ?? '';
				break;

			case 'tool.started':
				assistant.steps.push({
					key: `${data.tool_name}:${data.seq}`,
					tool_name: data.tool_name || 'tool',
					status: 'running',
					preview: data.preview,
					args: data.args,
					started_at: data.ts ?? Date.now() / 1000
				});
				break;

			case 'tool.completed':
			case 'tool.failed': {
				const status: ToolStep['status'] = event === 'tool.failed' ? 'failed' : 'done';
				// Match the most recent running step with the same tool name;
				// tool.started/completed carry different seq values.
				const step = [...assistant.steps]
					.reverse()
					.find((s) => s.tool_name === data.tool_name && s.status === 'running');
				if (step) {
					step.status = status;
					step.result = data.preview ?? step.result;
					step.ended_at = data.ts ?? Date.now() / 1000;
				} else {
					assistant.steps.push({
						key: `${data.tool_name}:${data.seq}`,
						tool_name: data.tool_name || 'tool',
						status,
						result: data.preview,
						started_at: data.ts ?? Date.now() / 1000,
						ended_at: data.ts ?? Date.now() / 1000
					});
				}
				break;
			}

			case 'assistant.completed':
				// Authoritative final text: deltas can miss content the agent
				// produced through non-streaming paths (e.g. tool-rendered media
				// resolved to data: URLs).
				if (typeof data.content === 'string' && data.content) assistant.content = data.content;
				break;

			case 'run.completed':
				assistant.streaming = false;
				break;

			case 'error': {
				const err = new ApiError(
					Number(data.status) || 500,
					data.message || 'Erreur inconnue',
					data.code
				);
				assistant.error = err.message;
				// A refused turn (429, bad payload) never started, so replaying
				// it is safe and is what the user wants.
				const canReplay = err.status === 429 || err.status >= 500;
				toasts.error(err, canReplay ? { label: 'Renvoyer', run: () => this.resend() } : undefined);
				break;
			}
		}
	}

	// -- export -------------------------------------------------------------

	/** Render the open conversation as a markdown document. */
	toMarkdown(): string {
		const session = this.current;
		const lines: string[] = [`# ${session?.title || 'Conversation Hermes'}`, ''];
		if (session?.model) lines.push(`_Modèle : ${session.model}_`, '');
		for (const msg of this.messages) {
			lines.push(msg.role === 'user' ? '## Vous' : '## Hermes', '');
			if (msg.steps.length) {
				lines.push(
					`<details><summary>${msg.steps.length} étape(s) d'agent</summary>`,
					'',
					...msg.steps.map((s) => `- \`${s.tool_name}\` — ${s.status}`),
					'',
					'</details>',
					''
				);
			}
			lines.push(msg.content || '_(vide)_', '');
		}
		return lines.join('\n');
	}
}

/** First line of the prompt, trimmed to something that fits a sidebar row. */
function titleFrom(text: string): string {
	const firstLine = text.split('\n').find((l) => l.trim()) ?? '';
	const clean = firstLine.trim().replace(/\s+/g, ' ');
	if (!clean) return 'Nouvelle discussion';
	return clean.length > 58 ? `${clean.slice(0, 57)}…` : clean;
}

export const chat = new ChatStore();
