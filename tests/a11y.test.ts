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
		['Modal.svelte', 1],
		// Same call for the mobile drawer, which is that same dialog.
		['Sidebar.svelte', 1]
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

/**
 * The mobile drawer is a dialog, and a closed drawer is not merely off screen.
 *
 * Under 820px the sidebar leaves the layout and slides over the thread behind
 * a scrim. Parked at `translateX(-100%)` it stayed fully reachable: Tab walked
 * through some twenty invisible controls before reaching the composer, and
 * VoiceOver read out a conversation list nobody could see. These tests pin the
 * three attributes that fix it, because none of them shows up in a screenshot.
 */
const SIDEBAR = readFileSync(
	new URL('../src/lib/components/Sidebar.svelte', import.meta.url),
	'utf8'
);

test('a closed drawer is inert, not just translated out of view', () => {
	assert.match(SIDEBAR, /inert=\{drawer && !open\}/);
});

test('an open drawer announces itself as a modal dialog', () => {
	// Only as a drawer: on a wide screen it is a plain column of the layout,
	// and a permanently visible `role="dialog"` would be a lie.
	assert.match(SIDEBAR, /role=\{modal \? 'dialog' : undefined\}/);
	assert.match(SIDEBAR, /aria-modal=\{modal \? 'true' : undefined\}/);
	assert.match(SIDEBAR, /aria-label=\{modal \? 'Discussions' : undefined\}/);
	assert.match(SIDEBAR, /let modal = \$derived\(drawer && open\)/);
});

test('the drawer reuses the dialog focus contract instead of copying it', () => {
	assert.match(SIDEBAR, /import \{ dialogFocus, trapTab \} from '\$lib\/client\/dialog\.svelte'/);
	const modal = readFileSync(new URL('../src/lib/components/Modal.svelte', import.meta.url), 'utf8');
	assert.match(modal, /import \{ dialogFocus, trapTab \} from '\$lib\/client\/dialog\.svelte'/);
	// The trap arithmetic and the focusable selector stay in one place too.
	const dialog = readFileSync(new URL('../src/lib/client/dialog.svelte.ts', import.meta.url), 'utf8');
	assert.match(dialog, /from '\$lib\/a11y'/);
});

/**
 * `Escape` closes the drawer, because Tab cannot leave it.
 *
 * A trap without a documented way out is a cage; every other modal surface in
 * the app already answers Escape.
 */
test('Escape closes the drawer before it stops a running turn', () => {
	const page = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');
	const escape = page.slice(page.indexOf("if (event.key === 'Escape')"));
	const drawer = escape.indexOf('sidebarOpen = false');
	const stop = escape.indexOf('chat.stop()');
	assert.ok(drawer > 0 && stop > 0, 'both branches must exist');
	assert.ok(drawer < stop, 'closing the drawer comes first');
});

/**
 * The row menu — rename, pin, branch, archive, delete — used to appear on
 * hover only. A finger has no hover, so on a phone those five actions were
 * unreachable on every row but the selected one; a Tab stop with `opacity: 0`
 * was just as invisible to a keyboard.
 */
test('the row actions are not hidden behind hover alone', () => {
	assert.match(SIDEBAR, /@media \(hover: hover\) and \(min-width: 821px\)/);
	assert.match(SIDEBAR, /\.row:focus-within \.more/);
	// `opacity: 0` on `.more` may only be declared inside that guarded block.
	const guarded = SIDEBAR.slice(SIDEBAR.indexOf('@media (hover: hover)'));
	const all = SIDEBAR.match(/\.more \{[^}]*opacity:\s*0/g) ?? [];
	const inside = guarded.match(/\.more \{[^}]*opacity:\s*0/g) ?? [];
	assert.equal(all.length, inside.length, '.more may only be hidden where a pointer can reveal it');
	assert.equal(inside.length, 1);
});

/**
 * One trap at a time.
 *
 * On a phone a settings panel opened from the drawer would sit on a dialog
 * that is itself trapping Tab, and two traps pulling in opposite directions is
 * worse than none — the drawer would drag the focus out of the panel the user
 * is actually in. So the drawer only answers a Tab pressed inside itself, and
 * opening a panel from it closes it.
 */
test('the drawer never traps a Tab pressed outside itself', () => {
	assert.match(SIDEBAR, /panel\.contains\(event\.target as Node\)/);
});

test('a settings panel opened from the sidebar closes it', () => {
	const page = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');
	for (const prop of ['onopenStatus', 'onopenSkills', 'onopenProviders', 'onopenJobs', 'onopenAgents', 'onopenTheme']) {
		assert.match(
			page,
			new RegExp(`${prop}=\\{\\(\\) => openFromSidebar\\(`),
			`${prop} must go through openFromSidebar`
		);
	}
	assert.match(page, /function openFromSidebar\([\s\S]{0,120}sidebarOpen = false/);
});
