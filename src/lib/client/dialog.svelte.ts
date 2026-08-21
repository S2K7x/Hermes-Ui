import { tick } from 'svelte';
import { FOCUSABLE_SELECTOR, trapIndex } from '$lib/a11y';

/**
 * What a modal surface owes the keyboard, in one place.
 *
 * `Modal.svelte` grew these two behaviours first; the mobile drawer of
 * `Sidebar.svelte` needs exactly the same ones — it is a dialog too, scrim
 * included, once the window is narrow enough for it to slide over the thread.
 * Copying twenty lines is how the seven panels drifted apart before point 21,
 * so they live here instead.
 */

/** The Tab stops of `root` that are really on screen. */
export function tabStops(root: HTMLElement): HTMLElement[] {
	// `getClientRects()` is how a hidden stop (a collapsed form, a list that is
	// scrolled out of view) is told from a real one — it also works inside
	// `position: fixed`, unlike `offsetParent`.
	return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
		(el) => el.getClientRects().length > 0
	);
}

/**
 * Keep a Tab press inside `root` instead of letting it walk into the page
 * behind. Does nothing for any other key, and nothing when the browser's own
 * move already stays inside — forcing focus there would break type-ahead and
 * text selection inside a field.
 */
export function trapTab(root: HTMLElement, event: KeyboardEvent): void {
	if (event.key !== 'Tab') return;
	const stops = tabStops(root);
	const index = trapIndex(
		stops.length,
		stops.indexOf(document.activeElement as HTMLElement),
		event.shiftKey
	);
	if (index === null && stops.length > 0) return;
	event.preventDefault();
	(index === null ? root : stops[index]).focus();
}

/**
 * Focus follows the dialog: in when it opens, back where it came from when it
 * closes.
 *
 * It lands on the container itself rather than on the first control, so a
 * screen reader announces the dialog and its name before anything else and no
 * field steals the caret — which on iOS would raise the keyboard for a panel
 * the user only meant to read. Call during component initialisation.
 */
export function dialogFocus(active: () => boolean, target: () => HTMLElement | null): void {
	$effect(() => {
		if (!active()) return;
		const opener = document.activeElement;
		void tick().then(() => target()?.focus({ preventScroll: true }));
		return () => {
			if (opener instanceof HTMLElement && opener.isConnected) {
				opener.focus({ preventScroll: true });
			}
		};
	});
}
