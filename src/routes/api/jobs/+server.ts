import type { RequestHandler } from './$types';
import { createJob, listJobs } from '$lib/server/hermes';
import { DashboardError, dashboardConfigured, getCronDeliveryTargets } from '$lib/server/dashboard';
import { errorResponse, gate, proxy, readJson } from '$lib/server/respond';
import { MAX_JOB_NAME, MAX_JOB_PROMPT, parseSchedule } from '$lib/jobs';
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
		return {
			jobs: jobs ?? [],
			targets: (targets?.targets ?? []) as DeliveryTarget[],
			targetsAvailable: targets !== null
		};
	});

interface CreateBody {
	name?: unknown;
	schedule?: unknown;
	prompt?: unknown;
	deliver?: unknown;
}

/**
 * Create a job.
 *
 * The schedule is validated here as well as in the browser: upstream turns an
 * unparseable one into an opaque HTTP 500, and this route is the last place
 * that can still say what is wrong in French.
 */
export const POST: RequestHandler = async ({ request }) => {
	const limited = gate('jobs-write', 1, 5);
	if (limited) return limited;

	const parsed = await readJson<CreateBody>(request);
	if ('response' in parsed) return parsed.response;

	const name = String(parsed.body.name ?? '').trim();
	const schedule = String(parsed.body.schedule ?? '').trim();
	const prompt = String(parsed.body.prompt ?? '').trim();
	const deliver = String(parsed.body.deliver ?? 'local').trim() || 'local';

	if (!name) return errorResponse(400, 'Donnez un nom à la tâche.', 'invalid_job');
	if (name.length > MAX_JOB_NAME) {
		return errorResponse(400, `Le nom dépasse ${MAX_JOB_NAME} caractères.`, 'invalid_job');
	}
	if (!prompt) return errorResponse(400, 'Décrivez ce que Hermes doit faire.', 'invalid_job');
	if (prompt.length > MAX_JOB_PROMPT) {
		return errorResponse(
			400,
			`L'instruction dépasse ${MAX_JOB_PROMPT} caractères.`,
			'invalid_job'
		);
	}
	const check = parseSchedule(schedule);
	if (check.kind === null) return errorResponse(400, check.error, 'invalid_schedule');

	return proxy(() => createJob({ name, schedule, prompt, deliver }));
};
