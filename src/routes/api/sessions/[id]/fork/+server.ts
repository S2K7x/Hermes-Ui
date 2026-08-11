import type { RequestHandler } from './$types';
import { forkSession } from '$lib/server/hermes';
import { proxy } from '$lib/server/respond';
import { bindSessionAgent, sessionAgentId } from '$lib/server/agents';

/**
 * Branch a conversation. Note the upstream semantics (matching the CLI's
 * /branch): the PARENT is closed with end_reason "branched" and the child
 * carries the transcript forward. The sidebar must refresh both rows.
 *
 * The branch keeps the parent's agent: it is the same conversation continued,
 * and Hermes' own fork already carries the stored `system_prompt` across.
 */
export const POST: RequestHandler = async ({ params, request }) =>
	proxy(async () => {
		const body = (await request.json().catch(() => ({}))) as { title?: string };
		const res = await forkSession(params.id, { title: body.title });
		const agentId = sessionAgentId(params.id);
		if (agentId && res.session?.id) {
			bindSessionAgent(res.session.id, agentId);
			return { ...res, session: { ...res.session, agent_id: agentId } };
		}
		return res;
	});
