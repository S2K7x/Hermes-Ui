/**
 * Finding a passage inside the conversation that is already open.
 *
 * The sidebar and the command palette match a conversation by its title and
 * its preview; neither can answer "where did it give me that command?". The
 * whole transcript is already in the browser — `openSession()` loads up to 500
 * messages — so that question is answerable without asking Hermes anything,
 * which matters twice on a phone: an installed PWA has no find-in-page at all,
 * and the gateway exposes no message search to fall back on (there is no such
 * route in `api_server.py`).
 *
 * Everything here is pure apart from one memo table, keyed by message id and
 * invalidated whenever that message's text changes.
 */

/** The little a search needs to know about a message. */
export interface SearchableMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp?: number;
}

/** One message that matched, with an excerpt around its first occurrence. */
export interface MessageMatch {
	id: string;
	role: 'user' | 'assistant';
	timestamp: number;
	/** How many times the query occurs in this message. */
	count: number;
	/** Excerpt, split so the match can be marked without building any HTML. */
	before: string;
	match: string;
	after: string;
}

/**
 * Below this, a query matches so much of a transcript that the hits are noise
 * — and every conversation row would be pushed off the palette by them.
 */
export const MIN_QUERY_CHARS = 2;

/** Characters of context kept on either side of the match in the excerpt. */
const BEFORE_CHARS = 34;
const AFTER_CHARS = 90;

// ---------------------------------------------------------------------------
// Case- and accent-insensitive matching, with an index back to the original
// ---------------------------------------------------------------------------

/**
 * A folded copy of a text, plus the origin of each of its characters.
 *
 * The fold has to be reversible enough to cut an excerpt out of the *original*
 * text: showing "resume" where the message says "résumé" would be quoting it
 * wrong. Hence `map`, where `map[i]` is the index in the source string of the
 * character that produced `text[i]`.
 */
interface Folded {
	text: string;
	map: number[];
}

/**
 * Fold one character: lowercase, then drop its combining marks.
 *
 * Memoised because `normalize()` is by far the expensive part and a transcript
 * only ever uses a few dozen distinct accented characters. Measured on this Pi
 * 5: folding a megabyte of French prose takes ~130 ms with the memo, against
 * seconds without — and ASCII, which is most of it, never reaches this at all.
 */
const charMemo = new Map<string, string>();
function foldChar(ch: string): string {
	let folded = charMemo.get(ch);
	if (folded === undefined) {
		folded = ch.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
		charMemo.set(ch, folded);
	}
	return folded;
}

function fold(input: string): Folded {
	const parts: string[] = [];
	const map: number[] = [];
	for (let i = 0; i < input.length; i++) {
		const code = input.charCodeAt(i);
		// Fast paths for ASCII, which needs neither normalisation nor a lookup.
		if (code >= 97 && code < 128) {
			parts.push(input[i]);
			map.push(i);
			continue;
		}
		if (code >= 65 && code <= 90) {
			parts.push(String.fromCharCode(code + 32));
			map.push(i);
			continue;
		}
		const folded = foldChar(input[i]);
		for (let k = 0; k < folded.length; k++) {
			parts.push(folded[k]);
			map.push(i);
		}
	}
	return { text: parts.join(''), map };
}

/**
 * Folded transcripts, keyed by message id.
 *
 * Without it every keystroke would refold the whole conversation. The stored
 * source text is compared before the entry is reused, so a message still
 * streaming — whose id is stable while its content grows — refolds instead of
 * answering from a stale copy.
 */
const foldCache = new Map<string, { source: string; folded: Folded }>();
/** Bounded so a long session cannot grow the table without end. */
const MAX_CACHED = 600;

function foldedOf(id: string, source: string): Folded {
	const hit = foldCache.get(id);
	if (hit && hit.source === source) return hit.folded;
	if (foldCache.size >= MAX_CACHED) foldCache.clear();
	const folded = fold(source);
	foldCache.set(id, { source, folded });
	return folded;
}

// ---------------------------------------------------------------------------
// Excerpts
// ---------------------------------------------------------------------------

/** Combining marks: dropped by the fold, so never part of a folded index. */
const MARK = /[\u0300-\u036f]/;

/** One line, no runs of blanks: an excerpt has to fit on a palette row. */
const squeeze = (s: string) => s.replace(/\s+/g, ' ');

function excerpt(source: string, start: number, end: number) {
	const from = Math.max(0, start - BEFORE_CHARS);
	const to = Math.min(source.length, end + AFTER_CHARS);
	// Only the outer edges are trimmed: the blank next to the match belongs to
	// the excerpt, or "…dit ceci" would read as one word.
	return {
		before: (from > 0 ? '…' : '') + squeeze(source.slice(from, start)).trimStart(),
		match: squeeze(source.slice(start, end)),
		after: squeeze(source.slice(end, to)).trimEnd() + (to < source.length ? '…' : '')
	};
}

// ---------------------------------------------------------------------------
// The search itself
// ---------------------------------------------------------------------------

/**
 * Messages of the open conversation containing `query`, most recent first.
 *
 * One row per message rather than per occurrence: the palette offers a place
 * to jump to, and a message is the thing that can be scrolled to. The number
 * of occurrences is reported so a row can say there are more.
 *
 * Recency order is deliberate — the view sits at the bottom of the transcript,
 * and in a conversation the last mention of something is usually the one being
 * looked for.
 */
export function findInMessages(
	messages: readonly SearchableMessage[],
	query: string,
	limit = 8
): MessageMatch[] {
	const needle = fold(query.trim()).text;
	if (needle.length < MIN_QUERY_CHARS || limit <= 0) return [];

	const out: MessageMatch[] = [];
	for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
		const message = messages[i];
		if (!message.content) continue;
		const { text, map } = foldedOf(message.id, message.content);

		let at = text.indexOf(needle);
		if (at < 0) continue;
		const first = at;
		let count = 0;
		while (at >= 0) {
			count++;
			at = text.indexOf(needle, at + needle.length);
		}

		const start = map[first] ?? 0;
		// One past the last source character the match covers: `map` gives the
		// origin of a folded character, and the fold can expand one character
		// into several.
		const lastFolded = first + needle.length - 1;
		let end = (map[lastFolded] ?? start) + 1;
		// Marks fold to nothing, so text stored decomposed ("e" + U+0301) would
		// leave its accent just outside the match, rendering on its own.
		while (end < message.content.length && MARK.test(message.content[end])) end++;
		out.push({
			id: message.id,
			role: message.role,
			timestamp: message.timestamp ?? 0,
			count,
			...excerpt(message.content, start, end)
		});
	}
	return out;
}
