import { FOCUSABLE_SELECTOR, menuIndex } from '$lib/a11y';

/**
 * What a popup menu owes the keyboard, in one place.
 *
 * Three surfaces open a floating panel from a button — the model picker, the
 * agent picker and the ⋯ of a sidebar row. All three were pointer-only: no
 * `aria-expanded`, no arrow keys, and above all no `Escape`. That last one was
 * not merely missing, it was harmful: the key bubbled up to the page handler
 * of `+page.svelte`, where `Escape` means "close the drawer" or, while a turn
 * is running, "detach the answer". Dismissing a dropdown must never do that.
 *
 * The same reasoning as `dialog.svelte.ts`: the arithmetic is pure and tested
 * in `a11y.ts`, only the DOM part lives here.
 */

/** What the caller must do once the key has been read. */
export type MenuKeyResult = 'close' | 'handled' | null;

/** The focus stops of an open popup that are really on screen. */
export function menuStops(panel: HTMLElement): HTMLElement[] {
	return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
		(el) => el.getClientRects().length > 0
	);
}

/**
 * Read one key pressed while a popup is open.
 *
 * Returns `'close'` for `Escape` — the caller closes and gives the focus back
 * to its trigger, which is the half no shared helper can do for it — and
 * `'handled'` when the focus has already been moved. `null` means the key was
 * not ours and the browser keeps it: Tab still walks the panel in DOM order.
 *
 * `Escape` is stopped here rather than in the caller so that no popup can
 * forget to: an unstopped `Escape` reaches the window handlers, which read it
 * as a much larger intent than "hide this list".
 */
export function menuKeydown(panel: HTMLElement | null | undefined, event: KeyboardEvent): MenuKeyResult {
	if (event.key === 'Escape') {
		event.preventDefault();
		event.stopPropagation();
		return 'close';
	}
	if (!panel) return null;
	const stops = menuStops(panel);
	const next = menuIndex(
		stops.length,
		stops.indexOf(document.activeElement as HTMLElement),
		event.key
	);
	if (next === null) return null;
	event.preventDefault();
	// Not `preventScroll`: unlike a dialog, a popup list scrolls internally and
	// the stop being walked onto may well be below the fold.
	stops[next].focus();
	return 'handled';
}
