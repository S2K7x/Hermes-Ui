import type { RequestHandler } from './$types';
import { forkSession } from '$lib/server/hermes';
import { proxy } from '$lib/server/respond';

/**
 * Branch a conversation. Note the upstream semantics (matching the CLI's
 * /branch): the PARENT is closed with end_reason "branched" and the child
 * carries the transcript forward. The sidebar must refresh both rows.
 */
export const POST: RequestHandler = async ({ params, request }) =>
	proxy(async () => {
		const body = (await request.json().catch(() => ({}))) as { title?: string };
		return forkSession(params.id, { title: body.title });
	});
