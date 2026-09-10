import { readJSON, writeJSON } from '$lib/client/storage';
import {
	clearDraft,
	draftKey,
	draftPreview,
	draftText,
	hasDraft,
	normalizeDrafts,
	renameDraft,
	setDraft,
	type DraftMap
} from '$lib/drafts';

const STORAGE_KEY = 'yadai-drafts';

/**
 * Trailing write delay.
 *
 * Serialising the whole map on every keystroke is pure waste on a phone; a
 * page that dies in between is covered by the flush on `pagehide`, which is
 * the event iOS actually fires before suspending a standalone PWA.
 */
const FLUSH_MS = 700;

class DraftStore {
	#map = $state<DraftMap>({});
	#timer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		// Read at import time, not lazily from a getter: the composer builds
		// its initial text from this before any effect has run, and a getter
		// that mutates state would do so from inside a derivation.
		this.#map = normalizeDrafts(readJSON<unknown>(STORAGE_KEY, null), Date.now());
		if (typeof window !== 'undefined') {
			window.addEventListener('pagehide', () => this.flush());
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'hidden') this.flush();
			});
		}
	}

	/** The unsent text for a conversation, '' when there is none. */
	get(sessionId: string | null | undefined): string {
		return draftText(this.#map, draftKey(sessionId));
	}

	has(sessionId: string | null | undefined): boolean {
		return hasDraft(this.#map, draftKey(sessionId));
	}

	/** One-line form of the draft, for a tooltip. '' when there is none. */
	preview(sessionId: string | null | undefined): string {
		return draftPreview(this.get(sessionId));
	}

	set(sessionId: string | null | undefined, text: string) {
		const next = setDraft(this.#map, draftKey(sessionId), text, Date.now());
		if (next === this.#map) return;
		this.#map = next;
		this.#schedule();
	}

	clear(sessionId: string | null | undefined) {
		const next = clearDraft(this.#map, draftKey(sessionId));
		if (next === this.#map) return;
		this.#map = next;
		this.#schedule();
	}

	/** Move a draft onto the id a conversation now answers to. */
	rename(from: string | null | undefined, to: string | null | undefined) {
		const next = renameDraft(this.#map, draftKey(from), draftKey(to));
		if (next === this.#map) return;
		this.#map = next;
		this.#schedule();
	}

	flush() {
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		writeJSON(STORAGE_KEY, this.#map);
	}

	#schedule() {
		if (this.#timer) return;
		this.#timer = setTimeout(() => {
			this.#timer = null;
			writeJSON(STORAGE_KEY, this.#map);
		}, FLUSH_MS);
	}
}

export const drafts = new DraftStore();
