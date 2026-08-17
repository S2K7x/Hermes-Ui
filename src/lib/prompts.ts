/**
 * Saved prompts — the phrases a daily user retypes.
 *
 * They live in this app's own SQLite (`prefs` table), not in Hermes: nothing
 * upstream stores a prompt library, and adding one there would mean patching
 * Hermes. Server-side rather than localStorage is the whole point — a prompt
 * saved from the desktop is there on the phone.
 *
 * Everything here is pure: the store owns the network and the ids, the route
 * reuses `normalizePrompts()` to bound what ever reaches the database.
 */

export interface SavedPrompt {
	id: string;
	title: string;
	text: string;
	created_at: number;
}

/** Bounds. The prefs row is a single JSON blob, so it has to stay small. */
export const MAX_PROMPTS = 40;
export const MAX_PROMPT_CHARS = 4000;
export const MAX_TITLE_CHARS = 60;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * A one-line label for a prompt: its first meaningful line, without the
 * markdown furniture that would make every title start with "#" or "-".
 */
export function promptTitle(text: string): string {
	for (const raw of text.split('\n')) {
		const line = raw
			.replace(/^\s*(?:[#>*+-]+|\d+[.)])\s*/, '')
			.replace(/\s+/g, ' ')
			.trim();
		if (line) return clip(line, MAX_TITLE_CHARS);
	}
	return 'Prompt';
}

/**
 * Coerce anything — a prefs blob written by an older version, a body posted by
 * a buggy client — into a bounded list of prompts. Never throws.
 */
export function normalizePrompts(value: unknown): SavedPrompt[] {
	if (!Array.isArray(value)) return [];
	const out: SavedPrompt[] = [];
	const seen = new Set<string>();

	for (const entry of value) {
		if (out.length >= MAX_PROMPTS) break;
		if (!entry || typeof entry !== 'object') continue;
		const row = entry as Record<string, unknown>;

		const text = typeof row.text === 'string' ? row.text.trim().slice(0, MAX_PROMPT_CHARS) : '';
		if (!text) continue;

		// Ids only have to be unique within the list; a missing or duplicated
		// one is repaired rather than dropping the prompt.
		let id = typeof row.id === 'string' && row.id.trim() ? row.id.trim().slice(0, 64) : '';
		if (!id || seen.has(id)) id = `p${out.length}_${text.length}`;
		if (seen.has(id)) continue;
		seen.add(id);

		const rawTitle = typeof row.title === 'string' ? row.title.replace(/\s+/g, ' ').trim() : '';
		const created = typeof row.created_at === 'number' && Number.isFinite(row.created_at) ? row.created_at : 0;

		out.push({
			id,
			title: rawTitle ? clip(rawTitle, MAX_TITLE_CHARS) : promptTitle(text),
			text,
			created_at: created > 0 ? created : 0
		});
	}
	return out;
}

export type PromptWriteRefusal = 'unloaded' | 'empty' | 'duplicate' | 'full';

export type PromptWriteResult =
	| { ok: true; list: SavedPrompt[] }
	| { ok: false; reason: PromptWriteRefusal };

/**
 * The library a write may be composed against, or `null` when it is unknown.
 *
 * `PUT /api/prompts` replaces the whole prefs row, so every write here is a
 * replace-all: whatever list goes in *is* the library afterwards. That makes
 * "we never managed to read it" a distinct state from "it is empty", and the
 * two must not be confused — composing a save against an unread library
 * deletes every prompt the user has, and reports success while doing it.
 *
 * Hence `null` rather than `[]`: the baseline is a required argument on both
 * write planners below, so a caller cannot forget to make that distinction.
 */
export type PromptBaseline = SavedPrompt[] | null;

/**
 * Prepend a prompt to the library. Newest first, because the reason to save a
 * prompt is to use it again soon.
 */
export function addPrompt(
	list: PromptBaseline,
	text: string,
	id: string,
	now: number,
	title?: string
): PromptWriteResult {
	if (list === null) return { ok: false, reason: 'unloaded' };

	const body = text.trim().slice(0, MAX_PROMPT_CHARS);
	if (!body) return { ok: false, reason: 'empty' };
	if (list.some((p) => p.text === body)) return { ok: false, reason: 'duplicate' };
	if (list.length >= MAX_PROMPTS) return { ok: false, reason: 'full' };

	const label = title?.replace(/\s+/g, ' ').trim();
	return {
		ok: true,
		list: [
			{ id, title: label ? clip(label, MAX_TITLE_CHARS) : promptTitle(body), text: body, created_at: now },
			...list
		]
	};
}

/** Drop one prompt. Same baseline rule as {@link addPrompt}, same reason. */
export function removePrompt(list: PromptBaseline, id: string): PromptWriteResult {
	if (list === null) return { ok: false, reason: 'unloaded' };
	return { ok: true, list: list.filter((p) => p.id !== id) };
}

// Strip combining marks so "resume" finds "résumé" — same rule as the sidebar
// search.
const normalize = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');

/** Case- and accent-insensitive substring match over title and body. */
export function matchPrompts(list: SavedPrompt[], query: string): SavedPrompt[] {
	const needle = normalize(query.trim());
	if (!needle) return list;
	return list.filter((p) => normalize(p.title).includes(needle) || normalize(p.text).includes(needle));
}
