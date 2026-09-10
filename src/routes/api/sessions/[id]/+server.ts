import type { RequestHandler } from './$types';
import { deleteSession, getSession, patchSession } from '$lib/server/hermes';
import { proxy } from '$lib/server/respond';
import { cacheTitle, forgetSession, trashSession } from '$lib/server/db';
import { sessionAgentId } from '$lib/server/agents';
import { TRASH_DAYS } from '$lib/trash';

export const GET: RequestHandler = ({ params }) =>
	proxy(async () => {
		const res = await getSession(params.id);
		// `agent_id` is this app's own field — Hermes knows nothing of personas.
		const agentId = sessionAgentId(params.id);
		return agentId ? { ...res, session: { ...res.session, agent_id: agentId } } : res;
	});

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

/**
 * Deleting a conversation puts it in the bin; it does not destroy it.
 *
 * Upstream has no soft delete to borrow — `DELETE /api/sessions/{id}` drops
 * the transcript, the tool calls and the FTS5 rows for good — so the only way
 * to make this reversible is to **not call it**. The default path therefore
 * touches nothing but our own `session_meta` row, and the conversation sits
 * untouched in `state.db` until the sweep collects it `TRASH_DAYS` later.
 *
 * `?purge=true` is the deliberate, irreversible one: emptying the bin by hand,
 * and the smoke test cleaning up after itself.
 */
export const DELETE: RequestHandler = ({ params, url }) =>
	proxy(async () => {
		if (url.searchParams.get('purge') === 'true') {
			const res = await deleteSession(params.id);
			forgetSession(params.id);
			return { ...res, purged: true };
		}
		const deletedAt = trashSession(params.id);
		return { deleted: true, trashed: true, session_id: params.id, deleted_at: deletedAt, days: TRASH_DAYS };
	});
