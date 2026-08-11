import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPref, setPref } from '$lib/server/db';
import { gate, readJson } from '$lib/server/respond';
import { normalizeTheme } from '$lib/theme';

/**
 * The chosen theme, stored in this app's own prefs table.
 *
 * Server-side and not localStorage, for the same reason as the saved prompts:
 * a palette picked on the desktop must be the one the phone opens with. The
 * browser still keeps a copy in localStorage, but only as a cache so the first
 * paint is not the default palette — this row is the truth.
 *
 * `normalizeTheme` is the only validation: it clamps the preset to a known id,
 * the mode to dark/light and each accent to a `#rrggbb` string or null, so a
 * malformed body can never write something the stylesheet would choke on.
 */

const KEY = 'theme';

export const GET: RequestHandler = () => {
	const limited = gate('theme-read', 4, 12);
	if (limited) return limited;
	return json({ theme: normalizeTheme(getPref(KEY, null)) });
};

export const PUT: RequestHandler = async ({ request }) => {
	const limited = gate('theme-write', 2, 10);
	if (limited) return limited;

	const parsed = await readJson<{ theme?: unknown }>(request);
	if ('response' in parsed) return parsed.response;

	const theme = normalizeTheme(parsed.body.theme);
	setPref(KEY, theme);
	return json({ theme });
};
