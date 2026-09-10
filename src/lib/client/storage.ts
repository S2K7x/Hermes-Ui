/**
 * localStorage that cannot throw.
 *
 * Safari in private mode, a full quota, and a locked-down WebView all make
 * `localStorage` throw on access — losing a theme preference must never take
 * the whole app down with it.
 */

function store(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

const PREFIX = 'yadai-';
const LEGACY_PREFIX = 'hermes-';

/**
 * The key a `yadai-` row used to be called, or `null` when it is not ours.
 *
 * Renaming the app renamed its storage keys, and a rename that silently drops
 * a half-written message is not one anybody asked for: `read()` moves a
 * legacy row across the first time it is asked for, so drafts, the last
 * conversation, the collapsed sidebar and the pre-paint theme cache survive
 * the first launch under the new name. Pure, so the mapping is testable
 * without a browser.
 */
export function legacyKey(key: string): string | null {
	return key.startsWith(PREFIX) ? LEGACY_PREFIX + key.slice(PREFIX.length) : null;
}

export function read(key: string): string | null {
	try {
		const s = store();
		if (!s) return null;
		const value = s.getItem(key);
		if (value !== null) return value;

		// Only reached once per key: the row is moved, not copied, so the next
		// read is a plain hit and an old row cannot resurrect a newer value.
		const old = legacyKey(key);
		if (old === null) return null;
		const carried = s.getItem(old);
		if (carried === null) return null;
		s.setItem(key, carried);
		s.removeItem(old);
		return carried;
	} catch {
		return null;
	}
}

export function write(key: string, value: string): void {
	try {
		store()?.setItem(key, value);
	} catch {
		/* quota or private mode — the preference just will not persist */
	}
}

export function remove(key: string): void {
	try {
		store()?.removeItem(key);
	} catch {
		/* ignore */
	}
}

export function readJSON<T>(key: string, fallback: T): T {
	const raw = read(key);
	if (raw === null) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export const writeJSON = (key: string, value: unknown) => write(key, JSON.stringify(value));
