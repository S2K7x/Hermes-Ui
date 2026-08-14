/**
 * Themes: a few named presets, two user-chosen accents, everything else
 * derived.
 *
 * The rule that keeps this small: a preset declares ten base colours per mode
 * and nothing more. Hovers, borders, faint text, soft accent washes and the
 * assistant bubble are all computed from those with `color-mix(in oklab, …)`,
 * so picking a new accent cannot leave a stale hover behind — there is only
 * one place a colour is written down.
 *
 * Two things are *not* left to CSS, because they need arithmetic no stylesheet
 * can do: which ink is readable on a colour, and how far an accent must be
 * deepened before white text on it passes 4.5:1. Both are pure functions here,
 * measured with the WCAG relative-luminance formula and tested.
 *
 * This module must stay browser-agnostic: the server route validates a saved
 * theme with `normalizeTheme`, and the store turns it into inline custom
 * properties with `themeVariables`.
 */

export type ThemeMode = 'dark' | 'light';

export interface ThemeSettings {
	preset: string;
	mode: ThemeMode;
	/** `null` means "whatever the preset says". */
	accent: string | null;
	accent2: string | null;
}

export interface PresetPalette {
	bg: string;
	surface: string;
	sunken: string;
	text: string;
	muted: string;
	accent: string;
	accent2: string;
	/** The dark icon rail, and the deep tone everything is deepened toward. */
	rail: string;
	danger: string;
	ok: string;
}

export interface ThemePreset {
	id: string;
	name: string;
	hint: string;
	dark: PresetPalette;
	light: PresetPalette;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const PRESETS: ThemePreset[] = [
	{
		id: 'terracotta',
		name: 'Terracotta',
		hint: 'Crème et orange, panneaux flottants',
		dark: {
			bg: '#141312',
			surface: '#221f1c',
			sunken: '#191614',
			text: '#f2ebe2',
			muted: '#a79c91',
			accent: '#ee7c2b',
			accent2: '#a6be79',
			rail: '#17130f',
			danger: '#e0705a',
			ok: '#86ae62'
		},
		light: {
			bg: '#dcdbd9',
			surface: '#fdfbf7',
			sunken: '#f5f1ea',
			text: '#2c211b',
			muted: '#7a6e64',
			accent: '#ee7c2b',
			accent2: '#a6be79',
			rail: '#2e211b',
			danger: '#d2563f',
			ok: '#6e9a4e'
		}
	},
	{
		id: 'ardoise',
		name: 'Ardoise',
		hint: "L'ancienne palette de Hermes-Ui",
		dark: {
			bg: '#1c1b19',
			surface: '#262523',
			sunken: '#151412',
			text: '#f0eee6',
			muted: '#a5a196',
			accent: '#d97757',
			accent2: '#6f9c86',
			rail: '#121110',
			danger: '#e05252',
			ok: '#5fa85f'
		},
		light: {
			bg: '#eceadf',
			surface: '#ffffff',
			sunken: '#f0eee6',
			text: '#26241f',
			muted: '#63605a',
			accent: '#c25f3c',
			accent2: '#4f8570',
			rail: '#26241f',
			danger: '#cc3333',
			ok: '#3f7d3f'
		}
	},
	{
		id: 'nocturne',
		name: 'Nocturne',
		hint: 'Bleu profond, accent indigo',
		dark: {
			bg: '#0f1117',
			surface: '#191c25',
			sunken: '#12141b',
			text: '#e7e9f2',
			muted: '#9aa0b5',
			accent: '#6d8cff',
			accent2: '#4fbfa8',
			rail: '#0b0d13',
			danger: '#e05a6b',
			ok: '#4fbf87'
		},
		light: {
			bg: '#dfe1e8',
			surface: '#ffffff',
			sunken: '#f1f3f8',
			text: '#1c1f2a',
			muted: '#656b7e',
			accent: '#4c67e0',
			accent2: '#2f9c88',
			rail: '#1c1f2a',
			danger: '#cc3f52',
			ok: '#2f8f5e'
		}
	},
	{
		id: 'verger',
		name: 'Verger',
		hint: 'Vert forêt et miel',
		dark: {
			bg: '#101410',
			surface: '#1b211b',
			sunken: '#141914',
			text: '#eaf0e6',
			muted: '#9aa895',
			accent: '#7fae52',
			accent2: '#d9a03c',
			rail: '#0d120d',
			danger: '#d9624c',
			ok: '#7fae52'
		},
		light: {
			bg: '#dcdfd6',
			surface: '#fbfcf7',
			sunken: '#eef1e8',
			text: '#232a20',
			muted: '#67705f',
			accent: '#5e8f37',
			accent2: '#c07c22',
			rail: '#232a20',
			danger: '#c0503c',
			ok: '#5e8f37'
		}
	}
];

export const DEFAULT_PRESET = 'terracotta';

export const DEFAULT_THEME: ThemeSettings = {
	preset: DEFAULT_PRESET,
	mode: 'dark',
	accent: null,
	accent2: null
};

export const presetById = (id: string): ThemePreset =>
	PRESETS.find((p) => p.id === id) ?? PRESETS[0];

// ---------------------------------------------------------------------------
// Colour arithmetic
// ---------------------------------------------------------------------------

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#ABC` / `abcdef` / `#ABCDEF` → `#abcdef`; anything else → `null`. */
export function normalizeHex(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const match = HEX.exec(value.trim());
	if (!match) return null;
	const body = match[1].toLowerCase();
	const full =
		body.length === 3
			? body
					.split('')
					.map((c) => c + c)
					.join('')
			: body;
	return `#${full}`;
}

function channels(hex: string): [number, number, number] {
	const clean = normalizeHex(hex) ?? '#000000';
	return [
		parseInt(clean.slice(1, 3), 16),
		parseInt(clean.slice(3, 5), 16),
		parseInt(clean.slice(5, 7), 16)
	];
}

const toHex = (n: number) =>
	Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** Straight sRGB channel blend. `t = 0` keeps `a`, `t = 1` gives `b`. */
export function mixHex(a: string, b: string, t: number): string {
	const [ar, ag, ab] = channels(a);
	const [br, bg, bb] = channels(b);
	const k = Math.max(0, Math.min(1, t));
	return `#${toHex(ar + (br - ar) * k)}${toHex(ag + (bg - ag) * k)}${toHex(ab + (bb - ab) * k)}`;
}

const linear = (c: number) => {
	const s = c / 255;
	return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(hex: string): number {
	const [r, g, b] = channels(hex);
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio, 1 … 21. */
export function contrastRatio(a: string, b: string): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Whichever of the two inks is more readable on `background`. */
export function readableInk(background: string, dark = '#1b1613', light = '#ffffff'): string {
	return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}

/**
 * Deepen `color` toward `toward` just far enough that `ink` on it reaches
 * `target`, and no further.
 *
 * This is what lets the user bubble be white-on-accent whatever accent the
 * user picks: a bright orange is walked a third of the way to the palette's
 * deepest tone — still unmistakably the accent — while an already-dark accent
 * is left alone. Without it, "white text on the accent" silently becomes
 * unreadable the moment someone picks a yellow.
 */
export function ensureContrast(color: string, ink: string, toward: string, target = 4.5): string {
	for (let t = 0; t <= 1.0001; t += 0.05) {
		const candidate = mixHex(color, toward, t);
		if (contrastRatio(candidate, ink) >= target) return candidate;
	}
	return toward;
}

/**
 * Nudge `color` toward `toward` until it is visible on *every* surface it can
 * be drawn on.
 *
 * This is the focus ring. WCAG 1.4.11 asks 3:1 for a control's visual
 * indicator, and the accent alone does not always give it: a deep indigo on
 * the near-black background of "Nocturne", or any dark colour the user types
 * into the accent field, would draw a ring nobody can see. Walking it toward
 * the text ink keeps it recognisably the accent while making it stand out —
 * and `toward` is the fallback, since text on its own surfaces is what the
 * presets already guarantee.
 */
export function ensureVisible(
	color: string,
	backgrounds: string[],
	toward: string,
	target = 3
): string {
	for (let t = 0; t <= 1.0001; t += 0.05) {
		const candidate = mixHex(color, toward, t);
		if (backgrounds.every((bg) => contrastRatio(candidate, bg) >= target)) return candidate;
	}
	return toward;
}

/** What the settings panel shows next to a colour input. */
export interface Readability {
	ink: string;
	ratio: number;
	/** WCAG AA for body text. */
	ok: boolean;
}

export function readability(color: string): Readability {
	const ink = readableInk(color);
	const ratio = contrastRatio(color, ink);
	return { ink, ratio: Math.round(ratio * 100) / 100, ok: ratio >= 4.5 };
}

// ---------------------------------------------------------------------------
// Settings → CSS custom properties
// ---------------------------------------------------------------------------

export function normalizeTheme(raw: unknown): ThemeSettings {
	const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const preset =
		typeof o.preset === 'string' && PRESETS.some((p) => p.id === o.preset)
			? o.preset
			: DEFAULT_PRESET;
	return {
		preset,
		mode: o.mode === 'light' ? 'light' : 'dark',
		accent: normalizeHex(o.accent),
		accent2: normalizeHex(o.accent2)
	};
}

/** The colours a preset would give, once the user's overrides are applied. */
export function effectivePalette(settings: ThemeSettings): PresetPalette {
	const preset = presetById(settings.preset);
	const base = settings.mode === 'light' ? preset.light : preset.dark;
	return {
		...base,
		accent: settings.accent ?? base.accent,
		accent2: settings.accent2 ?? base.accent2
	};
}

const mix = (a: string, b: string, pct: number) =>
	`color-mix(in oklab, ${a} ${100 - pct}%, ${b} ${pct}%)`;

/**
 * Every themed custom property, ready to be set on `<html>`.
 *
 * `app.css` declares the same names with literal defaults so the very first
 * paint of a fresh browser is not colourless; this map overrides them inline.
 * A token that exists in the stylesheet but not here would never follow a
 * preset change — `tests/theme.test.ts` reads `app.css` to make sure none
 * does.
 */
export function themeVariables(raw: unknown): Record<string, string> {
	const settings = normalizeTheme(raw);
	const p = effectivePalette(settings);
	const dark = settings.mode === 'dark';

	// Dark surfaces need a firmer nudge than light ones to read as a change.
	const step = dark
		? { hover: 11, border: 19, borderSoft: 11, bubble: 9, soft: 22, faint: 38 }
		: { hover: 7, border: 13, borderSoft: 8, bubble: 7, soft: 16, faint: 34 };

	// `palette.rail` is the deepest tone of the palette. In light mode that is
	// exactly what the icon column wants — a dark bar on a pale page. In dark
	// mode it would be a near-black column on a near-black page, invisible, so
	// the rail is raised *above* the surface there instead. `p.rail` stays the
	// anchor everything is deepened toward either way.
	const rail = dark ? mixHex(p.surface, p.text, 0.07) : p.rail;
	const railInk = readableInk(rail);

	return {
		'--bg': p.bg,
		'--bg-raised': p.surface,
		'--bg-sunken': p.sunken,
		'--bg-hover': mix(p.surface, p.text, step.hover),
		'--border': mix(p.surface, p.text, step.border),
		'--border-soft': mix(p.surface, p.text, step.borderSoft),
		'--text': p.text,
		'--text-muted': p.muted,
		'--text-faint': mix(p.muted, p.bg, step.faint),
		'--accent': p.accent,
		'--accent-ink': readableInk(p.accent),
		'--accent-soft': mix(p.surface, p.accent, step.soft),
		// The keyboard focus ring, drawn on the page, on a panel and on the
		// sunken fields alike — hence the three backgrounds.
		'--focus': ensureVisible(p.accent, [p.surface, p.bg, p.sunken], p.text),
		'--accent-2': p.accent2,
		'--accent-2-ink': readableInk(p.accent2),
		'--accent-2-soft': mix(p.surface, p.accent2, step.soft),
		'--danger': p.danger,
		'--danger-soft': mix(p.surface, p.danger, step.soft),
		'--ok': p.ok,
		'--code-bg': p.sunken,
		// The user bubble is the accent, deepened only as much as white text
		// requires — see `ensureContrast`.
		'--user-bubble': ensureContrast(p.accent, '#ffffff', p.rail),
		'--user-ink': '#ffffff',
		'--assistant-bubble': mix(p.surface, p.text, step.bubble),
		'--rail': rail,
		'--rail-ink': railInk,
		'--rail-hover': mix(rail, railInk, 14),
		'--shadow': dark ? '0 8px 28px rgba(0, 0, 0, 0.45)' : '0 8px 28px rgba(60, 45, 35, 0.1)',
		'--scrim': dark ? 'rgba(0, 0, 0, 0.58)' : 'rgba(44, 33, 27, 0.35)'
	};
}

/** What goes in `<meta name="theme-color">`: the page background. */
export const themeColor = (raw: unknown): string => effectivePalette(normalizeTheme(raw)).bg;
