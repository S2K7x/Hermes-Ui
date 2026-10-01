import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Reading a source file as text, for the tests that guard a *shape*.
 *
 * A handful of invariants in this app cannot be reached from `node --test`: the
 * stores are Svelte runes and the components are compiled markup, neither of
 * which imports under the type stripper. What those tests check is therefore
 * the source itself — "`init()` does not await the catalogue", "the three
 * conversation choices go through one helper". Crude, and still the difference
 * between an invariant that is documented and one that is enforced.
 *
 * It lives in its own module rather than in whichever test file needed it first
 * so the brace matcher below has one copy: `tests/boot.test.ts` owned it, and
 * `tests/choices.test.ts` would otherwise have owned a second one.
 */

/** A source file of the repo, by path relative to the repo root. */
export const source = (path: string): string =>
	readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/**
 * The text of one method, from its signature to the brace that closes it.
 *
 * Scoping an assertion to one method is what keeps it honest: `assert.match` on
 * a whole file would pass because some *other* method still does the thing.
 */
export function methodBody(src: string, signature: string): string {
	const start = src.indexOf(signature);
	assert.notEqual(start, -1, `${signature} not found`);
	let depth = 0;
	for (let i = src.indexOf('{', start); i < src.length; i++) {
		if (src[i] === '{') depth++;
		else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
	}
	assert.fail(`unbalanced braces after ${signature}`);
}
