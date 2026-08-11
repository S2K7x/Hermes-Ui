import { api, withRetry } from '$lib/client/api';
import {
	MAX_PROMPTS,
	addPrompt,
	normalizePrompts,
	removePrompt,
	type SavedPrompt
} from '$lib/prompts';
import { uid } from '$lib/transcript';
import { toasts } from './toast.svelte';

/** Why a save was refused, said in French. */
const REASONS: Record<string, string> = {
	empty: "Rien à enregistrer : le message est vide.",
	duplicate: 'Ce prompt est déjà enregistré.',
	full: `Bibliothèque pleine (${MAX_PROMPTS} prompts) — supprimez-en un d'abord.`
};

interface PromptsPayload {
	prompts: unknown;
}

/**
 * The saved-prompt library, mirrored from `/api/prompts`.
 *
 * Writes are optimistic and roll back on failure: a prompt that silently fails
 * to save is worse than one that visibly refuses to.
 */
class PromptStore {
	items = $state<SavedPrompt[]>([]);
	loaded = $state(false);
	saving = $state(false);

	#loading: Promise<void> | null = null;

	/** Load once; concurrent callers share the same request. */
	ensureLoaded(): Promise<void> {
		if (this.loaded) return Promise.resolve();
		this.#loading ??= this.#load().finally(() => (this.#loading = null));
		return this.#loading;
	}

	async #load() {
		try {
			const res = await withRetry(() => api<PromptsPayload>('/api/prompts'));
			this.items = normalizePrompts(res.prompts);
			this.loaded = true;
		} catch {
			// A library that cannot load does not deserve a banner: the rest of
			// the app works, and the next save reports the real error. Staying
			// unloaded lets a later open retry.
		}
	}

	async #persist(next: SavedPrompt[]): Promise<boolean> {
		const previous = this.items;
		this.items = next;
		this.saving = true;
		try {
			const res = await api<PromptsPayload>('/api/prompts', {
				method: 'PUT',
				body: JSON.stringify({ prompts: next })
			});
			// Adopt the server's version: it is the one that was bounded.
			this.items = normalizePrompts(res.prompts);
			this.loaded = true;
			return true;
		} catch (err) {
			this.items = previous;
			toasts.error(err);
			return false;
		} finally {
			this.saving = false;
		}
	}

	async add(text: string): Promise<boolean> {
		const result = addPrompt(this.items, text, uid('p'), Date.now() / 1000);
		if (!result.ok) {
			toasts.info(REASONS[result.reason]);
			return false;
		}
		return this.#persist(result.list);
	}

	async remove(id: string): Promise<boolean> {
		return this.#persist(removePrompt(this.items, id));
	}
}

export const prompts = new PromptStore();
