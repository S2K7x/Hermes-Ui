/**
 * Which modifier key to name in the UI.
 *
 * Showing "⌘K" to someone on Linux (or "Ctrl" to someone on a Mac) makes every
 * shortcut hint read as if it belongs to a different application, so this is
 * resolved once and reused by both the palette hints and the shortcut sheet.
 */
export function modKey(): string {
	if (typeof navigator === 'undefined') return 'Ctrl';
	const ua = navigator as Navigator & { userAgentData?: { platform?: string } };
	const platform = ua.userAgentData?.platform || navigator.platform || navigator.userAgent;
	return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl';
}

/** True when the event carries the platform's "command" modifier. */
export const hasMod = (event: KeyboardEvent) => event.metaKey || event.ctrlKey;
