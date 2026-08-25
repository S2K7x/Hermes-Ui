/**
 * Unsent composer text, kept per conversation.
 *
 * Two everyday losses this closes, both of them silent today:
 *
 * - An installed PWA is killed without warning while it sits in the
 *   background — on iOS routinely, after a couple of minutes. A half-typed
 *   message is simply gone when the app comes back.
 * - The composer is mounted once for the whole app, so its text followed the
 *   user from one conversation to the next. Half a question meant for one
 *   agent ended up one Enter away from being sent to another.
 *
 * Everything here is pure, so the bounds are testable without a browser; the
 * localStorage and debounce side lives in `stores/drafts.svelte.ts`.
 */

export interface Draft {
	text: string;
	/** Epoch ms of the last edit. Drives eviction and expiry, never display. */
	at: number;
}

export type DraftMap = Record<string, Draft>;

/** Key for text typed before a conversation exists (the welcome screen). */
export const NEW_DRAFT_KEY = 'new';

/** How many conversations keep a draft. */
export const MAX_DRAFTS = 24;

/** Total characters kept across every draft. */
export const MAX_TOTAL_CHARS = 120_000;

/**
 * A single draft longer than this is not persisted at all — the stored entry
 * is dropped instead.
 *
 * Deliberately not a truncation: a draft that came back shortened would be
 * sent shortened, and the user would have no way of telling. Above this bound
 * the text still lives in the composer for as long as the page does; it just
 * does not survive a reload. Typing never reaches it.
 */
export const MAX_DRAFT_CHARS = 100_000;

/** Drafts untouched for this long are dropped when the map is read. */
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Storage key for a conversation, or the welcome screen when there is none. */
export const draftKey = (sessionId: string | null | undefined): string =>
	sessionId || NEW_DRAFT_KEY;

/**
 * Keep the map inside its bounds: newest first, `keep` never evicted.
 *
 * `keep` is the entry that was just written — dropping the text the user is
 * typing to make room for older ones would be exactly backwards.
 */
function enforce(map: DraftMap, keep: string | null): DraftMap {
	const entries = Object.entries(map).sort((a, b) => b[1].at - a[1].at);
	const out: DraftMap = {};
	let count = 0;
	let chars = 0;

	if (keep && map[keep]) {
		out[keep] = map[keep];
		count = 1;
		chars = map[keep].text.length;
	}
	for (const [key, draft] of entries) {
		if (key === keep && out[key]) continue;
		if (count >= MAX_DRAFTS) break;
		if (chars + draft.text.length > MAX_TOTAL_CHARS) continue;
		out[key] = draft;
		count += 1;
		chars += draft.text.length;
	}
	return out;
}

/**
 * Rebuild a usable map out of whatever localStorage held.
 *
 * Never throws and never returns a partially-valid entry: a line written by an
 * older version, or corrupted by hand, degrades to "no draft" rather than to a
 * composer full of `[object Object]`.
 */
export function normalizeDrafts(raw: unknown, now: number): DraftMap {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const map: DraftMap = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!key || !value || typeof value !== 'object') continue;
		const { text, at } = value as { text?: unknown; at?: unknown };
		if (typeof text !== 'string' || !text.trim()) continue;
		if (text.length > MAX_DRAFT_CHARS) continue;
		const stamp = typeof at === 'number' && Number.isFinite(at) ? at : 0;
		// A stamp in the future (clock moved back) is kept: expiring it would
		// throw away text the user typed a moment ago.
		if (stamp <= now - DRAFT_TTL_MS) continue;
		map[key] = { text, at: stamp };
	}
	return enforce(map, null);
}

/** Record the composer's text for one conversation. Returns a new map. */
export function setDraft(map: DraftMap, key: string, text: string, now: number): DraftMap {
	// An empty composer is not a draft, and neither is one too big to store.
	if (!text.trim() || text.length > MAX_DRAFT_CHARS) return clearDraft(map, key);
	return enforce({ ...map, [key]: { text, at: now } }, key);
}

export function clearDraft(map: DraftMap, key: string): DraftMap {
	if (!(key in map)) return map;
	const out = { ...map };
	delete out[key];
	return out;
}

/**
 * Follow a conversation whose id changed under us (a context compression ends
 * the session and continues it in a child — CLAUDE.md point 23). An existing
 * draft on the destination wins: it is the more recent typing.
 */
export function renameDraft(map: DraftMap, from: string, to: string): DraftMap {
	if (from === to || !map[from] || map[to]) return map;
	const out = { ...map, [to]: map[from] };
	delete out[from];
	return out;
}

export const draftText = (map: DraftMap, key: string): string => map[key]?.text ?? '';

export const hasDraft = (map: DraftMap, key: string): boolean => Boolean(map[key]);

/** One-line form of a draft, for a sidebar tooltip. */
export function draftPreview(text: string, max = 70): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
