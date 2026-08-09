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

export function read(key: string): string | null {
	try {
		return store()?.getItem(key) ?? null;
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
