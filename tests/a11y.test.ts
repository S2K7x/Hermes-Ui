import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { FOCUSABLE_SELECTOR, trapIndex } from '../src/lib/a11y.ts';

/**
 * The focus trap of `Modal.svelte`, without a DOM.
 *
 * `trapIndex` answers one question: does this Tab press leave the dialog, and
 * if so where must focus be put back? Everything else — collecting the stops,
 * calling `.focus()` — is three lines in the component.
 */

test('Tab inside the dialog is left to the browser', () => {
	// Three stops, focus on the middle one: neither direction escapes.
	assert.equal(trapIndex(3, 1, false), null);
	assert.equal(trapIndex(3, 1, true), null);
});

test('Tab past the last stop wraps to the first, and back', () => {
	assert.equal(trapIndex(3, 2, false), 0);
	assert.equal(trapIndex(3, 0, true), 2);
});

test('Tab from the dialog itself enters at the right end', () => {
	// -1 is where focus sits when the dialog has just opened: the card.
	assert.equal(trapIndex(3, -1, false), 0);
	assert.equal(trapIndex(3, -1, true), 2);
	// Same for focus that somehow sits outside the collected stops.
	assert.equal(trapIndex(3, 9, false), 0);
});

test('a single stop keeps focus on itself', () => {
	// The ✕ button alone: Tab must not walk out to the page behind.
	assert.equal(trapIndex(1, 0, false), 0);
	assert.equal(trapIndex(1, 0, true), 0);
});

test('a dialog with nothing focusable asks for no move', () => {
	// The component then focuses the card, which cannot be expressed as an index.
	assert.equal(trapIndex(0, -1, false), null);
	assert.equal(trapIndex(0, -1, true), null);
});

test('the focusable selector skips disabled controls and script-only stops', () => {
	assert.ok(FOCUSABLE_SELECTOR.includes('button:not([disabled])'));
	assert.ok(FOCUSABLE_SELECTOR.includes('[tabindex]:not([tabindex="-1"])'));
	// The modal card itself carries tabindex="-1" and must never be a Tab stop.
	assert.ok(!/\[tabindex\](?!:not)/.test(FOCUSABLE_SELECTOR));
});

/**
 * A control whose focus ring was removed and never replaced is invisible to
 * anyone navigating with a keyboard. `:focus-visible` in `app.css` puts one
 * back on everything — but only where a component has not overridden it with a
 * more specific `outline: none`. Svelte scoping makes those overrides win, so
 * they are counted here: the two big text-editing surfaces keep the caret as
 * their indicator, and nothing else may join them without saying so.
 */
test('no control drops its focus ring behind the global one', () => {
	const dir = new URL('../src/lib/components/', import.meta.url);
	const allowed = new Map([
		// The composer box lights up instead (`.composer:focus-within`).
		['Composer.svelte', 1],
		// The skills editor fills its pane; the caret is the indicator there.
		['SkillsPanel.svelte', 1],
		// The dialog card takes focus on open so it is announced, not ringed.
		['Modal.svelte', 1]
	]);
	const files = readdirSync(dir).filter((f) => f.endsWith('.svelte'));
	assert.ok(files.length > 10, 'the components should be there');
	for (const name of files) {
		const source = readFileSync(new URL(name, dir), 'utf8');
		const count = source.match(/outline:\s*none/g)?.length ?? 0;
		assert.equal(count, allowed.get(name) ?? 0, `${name} removes a focus ring`);
	}

	const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
	assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
});
