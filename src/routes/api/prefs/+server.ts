import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAllPrefs, setPref } from '$lib/server/db';

export const GET: RequestHandler = () => json(getAllPrefs());

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	for (const [key, value] of Object.entries(body)) setPref(key, value);
	return json(getAllPrefs());
};
