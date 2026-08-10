import type { HermesMessage, ToolStep } from './types';

/** A turn as the UI renders it: one bubble, plus the agent steps behind it. */
export interface UiMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	/** Images the user attached, as data: URLs (echoed back into the bubble). */
	images: string[];
	steps: ToolStep[];
	reasoning: string;
	streaming: boolean;
	/**
	 * The turn is still running server-side but nothing is rendering it any
	 * more: either the user detached (`stopped`) or the stream ended before the
	 * turn did (`truncated`). Both offer a reload; only the wording differs.
	 */
	detached?: 'stopped' | 'truncated';
	error?: string;
	timestamp: number;
}

let counter = 0;
export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export function emptyAssistant(): UiMessage {
	return {
		id: uid('a'),
		role: 'assistant',
		content: '',
		images: [],
		steps: [],
		reasoning: '',
		streaming: true,
		timestamp: Date.now() / 1000
	};
}

/** Extract the text of a persisted message, whose content may be multimodal. */
function textOf(content: unknown): { text: string; images: string[] } {
	if (typeof content === 'string') return { text: content, images: [] };
	if (Array.isArray(content)) {
		const parts: string[] = [];
		const images: string[] = [];
		for (const part of content) {
			if (!part || typeof part !== 'object') continue;
			const p = part as Record<string, any>;
			if (p.type === 'text' && typeof p.text === 'string') parts.push(p.text);
			else if (p.type === 'image_url' && p.image_url?.url) images.push(p.image_url.url);
		}
		return { text: parts.join('\n'), images };
	}
	return { text: '', images: [] };
}

/**
 * Fold a persisted Hermes transcript into UI turns.
 *
 * The stored shape is user -> assistant(tool_calls) -> tool -> ... -> assistant.
 * Tool rows and intermediate assistant rows collapse into the trailing
 * assistant bubble's step list, so reloading a session looks like what the
 * live stream produced.
 */
export function groupTranscript(messages: HermesMessage[]): UiMessage[] {
	const out: UiMessage[] = [];
	let current: UiMessage | null = null;

	const flush = () => {
		if (current) out.push(current);
		current = null;
	};

	for (const msg of messages) {
		if (msg.role === 'system') continue;

		if (msg.role === 'user') {
			flush();
			const { text, images } = textOf(msg.content);
			out.push({
				id: String(msg.id ?? uid('u')),
				role: 'user',
				content: text,
				images,
				steps: [],
				reasoning: '',
				streaming: false,
				timestamp: msg.timestamp ?? Date.now() / 1000
			});
			continue;
		}

		if (!current) {
			current = {
				id: String(msg.id ?? uid('a')),
				role: 'assistant',
				content: '',
				images: [],
				steps: [],
				reasoning: '',
				streaming: false,
				timestamp: msg.timestamp ?? Date.now() / 1000
			};
		}

		if (msg.role === 'tool') {
			const { text } = textOf(msg.content);
			current.steps.push({
				key: String(msg.tool_call_id ?? uid('t')),
				tool_name: msg.tool_name || 'tool',
				status: 'done',
				result: text.slice(0, 4000),
				started_at: msg.timestamp ?? Date.now() / 1000
			});
			continue;
		}

		// assistant
		const calls = Array.isArray(msg.tool_calls) ? (msg.tool_calls as any[]) : [];
		for (const call of calls) {
			const name = call?.function?.name || call?.name;
			if (!name) continue;
			current.steps.push({
				key: String(call.id ?? uid('t')),
				tool_name: name,
				status: 'done',
				args: call?.function?.arguments ?? call?.arguments,
				started_at: msg.timestamp ?? Date.now() / 1000
			});
		}
		const reasoning = msg.reasoning || msg.reasoning_content;
		if (reasoning) current.reasoning += reasoning;
		const { text } = textOf(msg.content);
		// Intermediate assistant turns (the ones that only carry tool_calls)
		// have empty content, so the last non-empty one wins the bubble.
		if (text) current.content = current.content ? `${current.content}\n\n${text}` : text;
	}
	flush();

	// Merge duplicate step keys that both the tool_calls row and the tool
	// result row produced, keeping the result.
	for (const turn of out) {
		const seen = new Map<string, ToolStep>();
		for (const step of turn.steps) {
			const prev = seen.get(step.key);
			if (prev) Object.assign(prev, { ...step, result: step.result ?? prev.result });
			else seen.set(step.key, step);
		}
		turn.steps = [...seen.values()];
	}

	return out;
}

/** Emoji per Hermes tool family — mirrors the CLI's tool_progress display. */
export function toolIcon(name: string): string {
	if (name.startsWith('mcp_')) return '🔌';
	if (name === '_thinking') return '💭';
	if (name.startsWith('browser')) return '🌐';
	if (name.startsWith('web_')) return '🔍';
	if (name === 'terminal' || name === 'process') return '💻';
	if (name.includes('code')) return '🐍';
	if (['read', 'write', 'patch', 'search', 'file'].some((f) => name.includes(f))) return '📁';
	if (name.includes('memory')) return '🧠';
	if (name.includes('image')) return '🖼️';
	if (name.includes('todo')) return '✅';
	if (name.includes('cron')) return '⏰';
	if (name.includes('delegat')) return '🤝';
	return '🛠️';
}

/** Human label for an MCP tool: mcp_<server>_<tool> -> "server · tool". */
export function toolLabel(name: string): string {
	if (name.startsWith('mcp_')) {
		const rest = name.slice(4);
		const idx = rest.indexOf('_');
		if (idx > 0) return `${rest.slice(0, idx)} · ${rest.slice(idx + 1)}`;
	}
	return name;
}
