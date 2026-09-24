/**
 * The string rules this app repeats everywhere: fold, match, shorten, slug.
 *
 * Each of these had grown three or four copies, and the copies had started to
 * disagree with each other. The accent fold is the one that showed: the
 * sidebar and the saved prompts stripped combining marks before comparing —
 * so "resume" found "résumé" — while the model picker, the provider search,
 * the skills list and the command palette compared lowercase text as it came.
 * In the palette the two rules sat in the *same* search box: typing "modele"
 * found the conversation and the passage, never the « Modèle » command.
 *
 * So there is one definition of what "this matches that" means, and the
 * comments that used to say "same rule as the sidebar" are now true by
 * construction rather than by hand.
 *
 * Pure and dependency-free: `node --test` imports it straight through the type
 * stripper, and both the browser and the routes use the same copy.
 */

/** Combining marks, i.e. what NFD splits an accented letter into. */
const COMBINING = /[̀-ͯ]/g;

/**
 * Lowercase and strip accents, so "Résumé" and "resume" are the same word.
 *
 * NFD first splits « é » into `e` + U+0301; dropping the mark is what leaves a
 * letter a reader would have typed without thinking about their keyboard.
 */
export function foldAccents(input: string): string {
	return input.toLowerCase().normalize('NFD').replace(COMBINING, '');
}

/**
 * What a search box actually looks for: folded, and without the spaces a
 * half-typed query carries. Empty means "no filter", never "match nothing".
 */
export const searchNeedle = (query: string): string => foldAccents(query.trim());

/**
 * Does this field contain the needle, ignoring case and accents?
 *
 * An empty needle matches everything — the caller usually short-circuits
 * before getting here, and the callers that do not mean "no filter".
 */
export function includesFolded(field: string | null | undefined, needle: string): boolean {
	if (!needle) return true;
	if (!field) return false;
	return foldAccents(field).includes(needle);
}

/** Shorten to `max` characters, marking the cut with an ellipsis. */
export const clip = (s: string, max: number): string =>
	s.length > max ? `${s.slice(0, max - 1)}…` : s;

/** Collapse every run of whitespace, including newlines, into one space. */
export const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * A directory-safe, url-safe name derived from something a human typed.
 *
 * Accents are folded rather than dropped, so "Résumé d'articles" becomes
 * `resume-d-articles` and not `r-sum-d-articles`. The trailing dash is trimmed
 * again *after* the length cut, since the cut can land in the middle of a
 * separator. Returns `''` when nothing usable is left — the caller decides
 * what to do about that.
 */
export function slugify(input: string, max: number): string {
	return foldAccents(input)
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, max)
		.replace(/-+$/, '');
}
