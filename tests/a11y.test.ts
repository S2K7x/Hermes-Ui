import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import {
	FOCUSABLE_SELECTOR,
	menuIndex,
	trapIndex,
	turnAnnouncement,
	type AnnounceableTurn
} from '../src/lib/a11y.ts';

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
	// The sidebar has two doors now: the settings hub, and the status line.
	// Everything else is reached from inside the hub.
	for (const prop of ['onopenSettings', 'onopenStatus']) {
		assert.match(
			page,
			new RegExp(`${prop}=\\{\\(\\) => openFromSidebar\\(`),
			`${prop} must go through openFromSidebar`
		);
	}
	assert.match(page, /function openFromSidebar\([\s\S]{0,120}sidebarOpen = false/);
});

/**
 * The hub is a doorway, not a destination.
 *
 * It opens seven other dialogs, and a dialog opened on top of one that is
 * still trapping Tab is the same two-traps-pulling-apart problem the drawer
 * had: the focus would be dragged out of the panel the user is actually in.
 * So the hub closes itself first.
 */
test('the settings hub closes before opening what it points at', () => {
	const hub = readFileSync(
		new URL('../src/lib/components/SettingsPanel.svelte', import.meta.url),
		'utf8'
	);
	assert.match(hub, /function go\(run: \(\) => void\) \{\s*onclose\(\);\s*run\(\);/);
	// Every entry goes through it, so none can forget.
	assert.doesNotMatch(hub, /onclick=\{entry\.run\}/);
	assert.match(hub, /onclick=\{\(\) => go\(entry\.run\)\}/);
});


/**
 * The three popup menus — the model picker, the agent picker and the ⋯ of a
 * sidebar row — were pointer-only surfaces. `menuIndex` is the arrow-key half;
 * the rest of the contract is asserted against the sources below.
 */

test('Down and Up enter an open popup from its trigger', () => {
	// -1 is where focus sits when the popup has just been opened: on the button.
	assert.equal(menuIndex(5, -1, 'ArrowDown'), 0);
	assert.equal(menuIndex(5, -1, 'ArrowUp'), 4);
});

test('a popup list wraps at both ends instead of dropping out', () => {
	assert.equal(menuIndex(5, 4, 'ArrowDown'), 0);
	assert.equal(menuIndex(5, 0, 'ArrowUp'), 4);
	assert.equal(menuIndex(5, 1, 'ArrowDown'), 2);
	assert.equal(menuIndex(5, 1, 'ArrowUp'), 0);
});

test('Home and End reach the ends of a long list', () => {
	// The model picker shows up to 60 entries; counting them is not a plan.
	assert.equal(menuIndex(60, 31, 'Home'), 0);
	assert.equal(menuIndex(60, 31, 'End'), 59);
});

test('any other key is left to the browser', () => {
	for (const key of ['Tab', 'Enter', ' ', 'a', 'ArrowLeft', 'Escape']) {
		assert.equal(menuIndex(5, 1, key), null, key);
	}
});

test('an empty popup asks for no move', () => {
	// The model picker with no authenticated provider shows a hint and nothing else.
	assert.equal(menuIndex(0, -1, 'ArrowDown'), null);
	assert.equal(menuIndex(0, -1, 'End'), null);
});

test('a stale index is treated as focus sitting outside the list', () => {
	// The list can shrink under the focus: the picker filters as you type.
	assert.equal(menuIndex(3, 7, 'ArrowDown'), 0);
	assert.equal(menuIndex(3, 7, 'ArrowUp'), 2);
});

/**
 * Escape must die inside the popup.
 *
 * `+page.svelte` reads a bare Escape as a much larger intent — close the mobile
 * drawer, or, while a turn is streaming, detach the answer being written. A
 * dropdown left over the header used to hand it exactly that: dismissing the
 * model list stopped watching the reply. The stop lives in the shared helper so
 * that no popup can forget it.
 */
test('the shared popup helper swallows Escape', () => {
	const menu = readFileSync(new URL('../src/lib/client/menu.svelte.ts', import.meta.url), 'utf8');
	const escape = menu.slice(menu.indexOf("if (event.key === 'Escape')"));
	assert.match(escape.slice(0, 200), /event\.stopPropagation\(\)/);
	assert.match(menu, /from '\$lib\/a11y'/);
});

test('every popup routes its keys through that helper and gives the focus back', () => {
	const dir = new URL('../src/lib/components/', import.meta.url);
	for (const name of ['ModelPicker.svelte', 'AgentPicker.svelte', 'Sidebar.svelte']) {
		const source = readFileSync(new URL(name, dir), 'utf8');
		assert.match(source, /import \{ menuKeydown \} from '\$lib\/client\/menu\.svelte'/, name);
		assert.match(source, /menuKeydown\([\s\S]{0,40}\) === 'close'/, name);
		// The trigger announces the popup, and takes the focus back on Escape.
		assert.match(source, /aria-haspopup="true"/, name);
		assert.match(source, /aria-expanded=/, name);
		assert.match(source, /refocus[\s\S]{0,80}\.focus\(\)/, name);
	}
});

/**
 * A popup row is a tap target like any other. 6px of padding around 13px of
 * text is 30px tall — and in the sidebar menu "Supprimer" sits right under
 * "Archiver".
 */
test('popup rows are thumb-sized on a phone', () => {
	const dir = new URL('../src/lib/components/', import.meta.url);
	for (const name of ['ModelPicker.svelte', 'AgentPicker.svelte', 'Sidebar.svelte']) {
		const source = readFileSync(new URL(name, dir), 'utf8');
		const narrow = source.slice(source.indexOf('@media (max-width: 820px)'));
		assert.ok(narrow.length > 0, `${name} has no phone block`);
		assert.match(narrow, /\.(items button|menu button)[\s\S]{0,120}min-height: 44px/, name);
	}
});

/**
 * The turn's live region.
 *
 * The whole waiting experience — caret, tool steps, "affichage interrompu" —
 * is painted in a plain div that no screen reader watches, so pressing Enter
 * used to produce nothing audible at all, on turns that run for minutes.
 * `turnAnnouncement` is the sentence a polite region says instead.
 */
const turn = (over: Partial<AnnounceableTurn> = {}): AnnounceableTurn => ({
	role: 'assistant',
	content: '',
	streaming: false,
	steps: [],
	...over
});

test('nothing is announced when there is no assistant turn to talk about', () => {
	assert.equal(turnAnnouncement(undefined), '');
	// The user's own bubble is the last message only until the empty
	// assistant is pushed next to it; either way it is not spoken.
	assert.equal(turnAnnouncement(turn({ role: 'user', content: 'salut' })), '');
});

test('a running turn says which phase it is in', () => {
	assert.equal(turnAnnouncement(turn({ streaming: true })), 'Yadai réfléchit.');
	assert.equal(turnAnnouncement(turn({ streaming: true, content: 'Voici' })), 'Réponse en cours.');
});

test('the newest running tool is the one named', () => {
	const steps: AnnounceableTurn['steps'] = [
		{ tool_name: 'terminal', status: 'done' },
		{ tool_name: 'web_search', status: 'running' }
	];
	assert.equal(turnAnnouncement(turn({ streaming: true, steps })), 'Outil web_search en cours.');
	// Once it completes, the phase falls back to the text being written.
	steps[1].status = 'done';
	assert.equal(
		turnAnnouncement(turn({ streaming: true, steps, content: 'a' })),
		'Réponse en cours.'
	);
});

test('the end of a turn is announced, with the work it took', () => {
	assert.equal(turnAnnouncement(turn({ content: 'fini' })), 'Réponse terminée.');
	assert.equal(
		turnAnnouncement(turn({ content: 'fini', steps: [{ tool_name: 'terminal', status: 'done' }] })),
		'Réponse terminée après 1 outil.'
	);
	assert.equal(
		turnAnnouncement(
			turn({
				content: 'fini',
				steps: [
					{ tool_name: 'terminal', status: 'done' },
					{ tool_name: 'read_file', status: 'done' }
				]
			})
		),
		'Réponse terminée après 2 outils.'
	);
	assert.equal(turnAnnouncement(turn({})), 'Tour terminé sans réponse.');
});

test('a turn that failed or was let go says so instead of "terminée"', () => {
	assert.equal(
		turnAnnouncement(turn({ error: 'Hermes est injoignable.' })),
		'Erreur : Hermes est injoignable.'
	);
	assert.match(turnAnnouncement(turn({ detached: 'stopped' })), /^Affichage interrompu\./);
	assert.match(turnAnnouncement(turn({ detached: 'truncated' })), /incomplète\.$/);
	// Detaching leaves `streaming` false, but a truncation is noticed while the
	// flag may still be up: the reason must win over the phase either way.
	assert.match(turnAnnouncement(turn({ streaming: true, detached: 'truncated' })), /incomplète\.$/);
});

/**
 * The region only exists if the page renders it, and it must stay silent about
 * a transcript loaded from history — announcing "Réponse terminée." about a
 * conversation the user has just *opened* would be a lie about their own action.
 */
test('the page owns a polite live region gated on a turn it watched stream', () => {
	const page = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');
	assert.match(page, /import \{ turnAnnouncement \} from '\$lib\/a11y'/);
	assert.match(page, /aria-live="polite"/);
	assert.match(page, /class="sr-only"[^>]*role="status"/);
	assert.match(page, /liveTurnId/);
	assert.match(page, /last\.id === liveTurnId/);
});

/**
 * Two glyphs and a transcript of unattributed paragraphs. A screen reader read
 * the send button as "↑" and gave no clue whether a message came from the user
 * or from Hermes.
 */
test('the conversation says who is speaking, and the composer names its controls', () => {
	const dir = new URL('../src/lib/components/', import.meta.url);
	const message = readFileSync(new URL('Message.svelte', dir), 'utf8');
	assert.match(message, /<span class="sr-only">Vous :<\/span>/);
	assert.match(message, /<span class="sr-only">Yadai :<\/span>/);

	const composer = readFileSync(new URL('Composer.svelte', dir), 'utf8');
	assert.match(composer, /aria-label="Envoyer le message"/);
	assert.match(composer, /aria-label="Arrêter l'affichage"/);
	// The textarea's name must not flip to "Hermes travaille…" mid-turn.
	assert.match(composer, /aria-label="Message à Yadai"/);
});

/**
 * The phone header, measured rather than assumed.
 *
 * At 390px the header carries a burger, the conversation's title and four
 * controls. Measured in Chromium at that width: the title element was **zero
 * pixels wide** — the token counter beside it and controls that would not
 * shrink had taken every pixel, and `min-width: 0` let the title collapse
 * silently instead of overflowing where it would have been noticed. The name
 * of what you are reading is not the thing that gives way.
 */
test('the phone header keeps the conversation title', () => {
	const page = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');
	// The counter is a desktop nicety; the same figures are in the status panel.
	assert.match(page, /\{#if usage && !narrow\}/);
	const phone = page.slice(page.indexOf('@media (max-width: 820px)'));
	assert.match(phone, /\.head-actions \{[^}]*flex:\s*0 0 auto/);
	assert.match(phone, /\.heading \{[^}]*min-width:\s*\d+px/);
	// Five controls beside the title left it three characters wide. Apparence
	// steps aside because it is also in the drawer's footer and in the palette;
	// the conversation's name has nowhere else to be shown.
	assert.match(phone, /\.icon\.theme \{[^}]*display:\s*none/);
	assert.match(page, /class="icon theme"[\s\S]{0,120}aria-label="Apparence"/);
	assert.match(page, /id: 'appearance'/);
});

/**
 * An empty composer must be one row tall on a phone.
 *
 * The placeholder's parenthetical hint wrapped at 390px, which made the bar
 * two rows tall before a single character was typed. A placeholder cannot be
 * changed from CSS, so the width the page already tracks for the drawer is
 * passed down instead of being measured a second time.
 */
test('the composer shortens its placeholder where the bar is narrow', () => {
	const composer = readFileSync(
		new URL('../src/lib/components/Composer.svelte', import.meta.url),
		'utf8'
	);
	assert.match(composer, /let \{ narrow = false \}: Props = \$props\(\)/);
	assert.match(composer, /narrow\s*\?\s*'Écrire à Yadai…'/);
	const page = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');
	assert.match(page, /<Composer bind:this=\{composer\} \{narrow\} \/>/);
});

/**
 * 44px is what this app promises a thumb everywhere else (point 20). The
 * round controls of the composer were measured at 36px, and the two header
 * pickers at 34px.
 */
test('every round control is thumb-sized on a phone', () => {
	const dir = new URL('../src/lib/components/', import.meta.url);
	const composer = readFileSync(new URL('Composer.svelte', dir), 'utf8');
	const phone = composer.slice(composer.indexOf('@media (max-width: 820px)'));
	assert.match(phone, /\.attach,\s*\n\s*\.send \{[^}]*width:\s*44px/);
	assert.match(phone, /\.attach,\s*\n\s*\.send \{[^}]*height:\s*44px/);

	for (const name of ['ModelPicker.svelte', 'AgentPicker.svelte']) {
		const source = readFileSync(new URL(name, dir), 'utf8');
		const block = source.slice(source.indexOf('@media (max-width: 820px)'));
		assert.match(block, /\.trigger \{[^}]*min-height:\s*44px/, name);
	}

	const message = readFileSync(new URL('Message.svelte', dir), 'utf8');
	const acts = message.slice(message.indexOf('@media (max-width: 820px)'));
	assert.match(acts, /\.actions button \{[^}]*min-height:\s*44px/);

	// The welcome screen's agent chips, measured at 38px.
	const page = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');
	const pagePhone = page.slice(page.indexOf('@media (max-width: 820px)'));
	assert.match(pagePhone, /\.agent-chip \{[^}]*min-height:\s*44px/);
});

/** Clipped, not hidden: `display: none` would drop it from the a11y tree too. */
test('sr-only text stays in the accessibility tree', () => {
	const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
	const rule = css.slice(css.indexOf('.sr-only {'), css.indexOf('.sr-only {') + 260);
	assert.ok(rule.startsWith('.sr-only {'), 'app.css declares .sr-only');
	assert.match(rule, /clip-path: inset\(50%\)/);
	assert.doesNotMatch(rule, /display:\s*none|visibility:\s*hidden/);
});
