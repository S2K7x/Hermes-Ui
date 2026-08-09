import type { RequestHandler } from './$types';
import { deleteSession, getSession, patchSession } from '$lib/server/hermes';
import { proxy } from '$lib/server/respond';
import { cacheTitle, forgetSession } from '$lib/server/db';

export const GET: RequestHandler = ({ params }) => proxy(() => getSession(params.id));

export const PATCH: RequestHandler = async ({ params, request }) =>
	proxy(async () => {
		const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
		// Upstream 400s on anything outside this set.
		const allowed = ['title', 'pinned', 'archived', 'end_reason'] as const;
		const patch: Record<string, unknown> = {};
		for (const key of allowed) if (key in body) patch[key] = body[key];
		const res = await patchSession(params.id, patch);
		if (typeof patch.title === 'string') cacheTitle(params.id, patch.title);
		return res;
	});

export const DELETE: RequestHandler = ({ params }) =>
	proxy(async () => {
		const res = await deleteSession(params.id);
		forgetSession(params.id);
		return res;
	});
