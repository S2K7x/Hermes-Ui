import type { RequestHandler } from './$types';
import { createJob, listJobs } from '$lib/server/hermes';
import { DashboardError, dashboardConfigured, getCronDeliveryTargets } from '$lib/server/dashboard';
import {
	decorateJobs,
	jobPromptFor,
	pruneJobMeta,
	readJobInput,
	rememberJob,
	type JobBody
} from '$lib/server/jobs';
import { gate, proxy, readJson } from '$lib/server/respond';
import type { DeliveryTarget } from '$lib/jobs';

/**
 * The scheduled-jobs panel, in one round trip: the jobs themselves from the
 * gateway, and where they may deliver from the dashboard.
 *
 * The two upstreams fail independently. A stopped `hermes-dashboard` must not
 * hide the job list, so the targets degrade to `local` only — which is exactly
 * what the panel can still promise without knowing the home channels.
 */
export const GET: RequestHandler = () =>
	proxy(async () => {
		const targets = dashboardConfigured()
			? await getCronDeliveryTargets().catch((err) => {
					if (err instanceof DashboardError) return null;
					throw err;
				})
			: null;
		const { jobs } = await listJobs();
		const list = jobs ?? [];
		pruneJobMeta(list.map((job) => job.id).filter((id): id is string => typeof id === 'string'));
		return {
			jobs: decorateJobs(list),
			targets: (targets?.targets ?? []) as DeliveryTarget[],
			targetsAvailable: targets !== null
		};
	});

/** Create a task, with the chosen agent's card baked into its prompt. */
export const POST: RequestHandler = async ({ request }) => {
	const limited = gate('jobs-write', 1, 5);
	if (limited) return limited;

	const parsed = await readJson<JobBody>(request);
	if ('response' in parsed) return parsed.response;

	const input = readJobInput(parsed.body);
	if (input instanceof Response) return input;

	return proxy(async () => {
		const created = await createJob({
			name: input.name,
			schedule: input.schedule,
			prompt: jobPromptFor(input.agentId, input.instruction),
			deliver: input.deliver
		});
		// The binding is recorded only once the job exists: an id we invented
		// for a creation that failed would linger as a row pointing nowhere.
		if (created.job?.id) {
			rememberJob(created.job.id, input.agentId, input.instruction);
		}
		return { job: { ...created.job, agent_id: input.agentId, instruction: input.instruction } };
	});
};
