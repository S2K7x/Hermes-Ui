import type { RequestHandler } from './$types';
import { getSession } from '$lib/server/hermes';
import { proxy } from '$lib/server/respond';
import { restoreSession } from '$lib/server/db';
import { sessionAgentId } from '$lib/server/agents';

/**
 * Take a conversation back out of the bin.
 *
 * Nothing has to be rebuilt: the delete never reached Hermes, so the session,
 * its transcript and its counters are exactly where they were. Clearing the
 * flag is the whole restore — which is the point of never having called the
 * upstream delete in the first place.
 *
 * The row is read back so the caller can drop it straight into the sidebar,
 * in the right list, without waiting for the next refresh.
 */
export const POST: RequestHandler = ({ params }) =>
	proxy(async () => {
		restoreSession(params.id);
		const res = await getSession(params.id);
		const agentId = sessionAgentId(params.id);
		return {
			restored: true,
			session: agentId ? { ...res.session, agent_id: agentId } : res.session
		};
	});
