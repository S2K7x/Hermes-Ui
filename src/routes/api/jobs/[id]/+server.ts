import type { RequestHandler } from './$types';
import { deleteJob, jobAction } from '$lib/server/hermes';
import { errorResponse, gate, proxy, readJson } from '$lib/server/respond';

const ACTIONS = new Set(['pause', 'resume', 'run']);

/** `_JOB_ID_RE` upstream: 12 lowercase hex characters, nothing else. */
const JOB_ID_RE = /^[a-f0-9]{12}$/;

function badId(id: string): Response | null {
	return JOB_ID_RE.test(id)
		? null
		: errorResponse(400, 'Identifiant de tâche invalide.', 'invalid_job_id');
}

interface ActionBody {
	action?: unknown;
}

/** Pause / resume / run now. `run` fires the job immediately, out of schedule. */
export const POST: RequestHandler = async ({ params, request }) => {
	const limited = gate('jobs-write', 1, 5);
	if (limited) return limited;

	const invalid = badId(params.id);
	if (invalid) return invalid;

	const parsed = await readJson<ActionBody>(request);
	if ('response' in parsed) return parsed.response;

	const action = String(parsed.body.action ?? '');
	if (!ACTIONS.has(action)) return errorResponse(400, 'Action inconnue.', 'invalid_job_action');

	return proxy(() => jobAction(params.id, action as 'pause' | 'resume' | 'run'));
};

export const DELETE: RequestHandler = async ({ params }) => {
	const limited = gate('jobs-write', 1, 5);
	if (limited) return limited;

	const invalid = badId(params.id);
	if (invalid) return invalid;

	return proxy(() => deleteJob(params.id));
};
