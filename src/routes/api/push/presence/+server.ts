import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { reportPresence } from '$lib/server/turns';
import { gate, readJson } from '$lib/server/respond';

/**
 * "Is the app on screen right now?"
 *
 * Whether a browser is still attached to the SSE stream answers this on iOS,
 * where the OS suspends a backgrounded PWA and the connection dies — but not on
 * a desktop, where a background tab keeps reading and would silence every
 * notification. So the page reports its `visibilityState` here, and a finished
 * turn notifies when either signal says nobody was looking (`shouldNotifyTurn`
 * in `src/lib/turns.ts`).
 *
 * Fire-and-forget by design: the client sends this with `keepalive` on
 * `pagehide`, and a lost report only costs one notification decision.
 */
export const POST: RequestHandler = async ({ request }) => {
	const limited = gate('push-presence', 2, 20);
	if (limited) return limited;

	const parsed = await readJson<{ visible?: unknown }>(request);
	if ('response' in parsed) return parsed.response;

	reportPresence(parsed.body.visible === true);
	return json({ ok: true });
};
