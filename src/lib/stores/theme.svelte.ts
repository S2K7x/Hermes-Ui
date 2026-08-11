import { api, withRetry } from '$lib/client/api';
import { write } from '$lib/client/storage';
import {
	DEFAULT_THEME,
	normalizeTheme,
	themeColor,
	themeVariables,
	type ThemeMode,
	type ThemeSettings
} from '$lib/theme';
import { toasts } from './toast.svelte';

/**
 * The active theme.
 *
 * Two storages on purpose. `/api/theme` is the truth — that is what makes the
 * phone and the desktop agree — but a network round-trip happens long after
 * the first paint, so the computed custom properties are also cached in
 * localStorage under `CACHE_KEY` and replayed by the inline script in
 * `app.html` before anything renders. Without that cache every launch flashes
 * the default palette.
 *
 * The cache holds the *computed* variables, not the settings: the early script
 * then needs no logic at all, and there is no second copy of the derivation
 * rules to keep in step with `theme.ts`.
 */

const CACHE_KEY = 'hermes-theme-cache';

interface ThemePayload {
	theme: unknown;
}

interface Cached {
	mode: ThemeMode;
	vars: Record<string, string>;
}

class ThemeStore {
	settings = $state<ThemeSettings>({ ...DEFAULT_THEME });
	loaded = $state(false);
	saving = $state(false);

	#timer: ReturnType<typeof setTimeout> | null = null;

	/** Paint the current settings, then reconcile with the server. */
	async init(): Promise<void> {
		this.#apply(this.settings);
		try {
			const res = await withRetry(() => api<ThemePayload>('/api/theme'));
			this.settings = normalizeTheme(res.theme);
			this.#apply(this.settings);
		} catch {
			// A theme that cannot load is not worth a banner: the cached one is
			// already on screen and the next change will report the real error.
		} finally {
			this.loaded = true;
		}
	}

	/** Apply immediately, persist a moment later — dragging a colour input
	 *  fires continuously and must not fire one PUT per pixel. */
	update(patch: Partial<ThemeSettings>): void {
		this.settings = normalizeTheme({ ...this.settings, ...patch });
		this.#apply(this.settings);
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.#persist(), 400);
	}

	reset(): void {
		this.update({ ...DEFAULT_THEME });
	}

	toggleMode(): void {
		this.update({ mode: this.settings.mode === 'dark' ? 'light' : 'dark' });
	}

	#apply(settings: ThemeSettings): void {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		const vars = themeVariables(settings);
		root.dataset.theme = settings.mode;
		for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);

		// The status bar of an installed PWA follows this, so it has to move
		// with the page background or the notch area stays the old colour.
		const meta = document.querySelector('meta[name="theme-color"]');
		if (meta) meta.setAttribute('content', themeColor(settings));

		const cached: Cached = { mode: settings.mode, vars };
		write(CACHE_KEY, JSON.stringify(cached));
	}

	async #persist(): Promise<void> {
		this.#timer = null;
		this.saving = true;
		try {
			const res = await api<ThemePayload>('/api/theme', {
				method: 'PUT',
				body: JSON.stringify({ theme: this.settings })
			});
			// Adopt the server's version: it is the one that was validated.
			this.settings = normalizeTheme(res.theme);
			this.#apply(this.settings);
		} catch (err) {
			toasts.error(err);
		} finally {
			this.saving = false;
		}
	}
}

export const theme = new ThemeStore();
