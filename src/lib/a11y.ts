/**
 * Keyboard navigation helpers.
 *
 * Only the arithmetic lives here — which stop Tab should land on when it is
 * about to walk out of a dialog. Collecting the candidates and moving the
 * focus stays in `Modal.svelte`, because the tests run without a DOM.
 */

/**
 * What Tab can reach, as a selector.
 *
 * Deliberately narrower than the full HTML definition: this app has no
 * `contenteditable`, no `<audio controls>` and no `<area>`. `[tabindex="-1"]`
 * is excluded because it means "focusable by script, not by Tab" — the modal
 * card itself carries it.
 */
export const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'summary',
	'[tabindex]:not([tabindex="-1"])'
].join(', ');

/**
 * Where focus must be *forced* so a Tab press cannot leave a modal dialog.
 *
 * `count` is how many focusable stops the dialog holds, `active` the index of
 * the one holding focus (`-1` when focus sits on the dialog itself, which is
 * where it lands when the dialog opens). Returns the index to focus, or `null`
 * when the browser's own move already stays inside and must be left alone —
 * moving focus by hand in that case would break type-ahead and text selection
 * inside a field.
 */
export function trapIndex(count: number, active: number, backwards: boolean): number | null {
	if (count <= 0) return null;
	if (active < 0 || active >= count) return backwards ? count - 1 : 0;
	if (backwards) return active === 0 ? count - 1 : null;
	return active === count - 1 ? 0 : null;
}

/**
 * Where an arrow key must put the focus inside an open popup menu.
 *
 * `count` is how many focus stops the popup holds, `active` the index of the
 * one holding focus — `-1`, or anything out of range, when focus is still on
 * the button that opened it. Returns the index to focus, or `null` when the
 * key means nothing here and must be left to the browser.
 *
 * Down and up wrap, because a popup is a closed list: walking off the end of
 * five actions should return to the first, not fall silently out of the menu.
 * From the trigger, Down enters at the top and Up at the bottom — the two ways
 * a keyboard user reaches "the last item" without counting.
 */
export function menuIndex(count: number, active: number, key: string): number | null {
	if (count <= 0) return null;
	const outside = active < 0 || active >= count;
	switch (key) {
		case 'ArrowDown':
			return outside ? 0 : (active + 1) % count;
		case 'ArrowUp':
			return outside ? count - 1 : (active - 1 + count) % count;
		case 'Home':
			return 0;
		case 'End':
			return count - 1;
		default:
			return null;
	}
}
