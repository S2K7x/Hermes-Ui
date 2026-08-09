import type { RequestHandler } from './$types';
import { getHealthDetailed, listJobs } from '$lib/server/hermes';
import { currentTurns, turnLimit } from '$lib/server/limits';
import { proxy } from '$lib/server/respond';

/**
 * Rich status for the diagnostics panel: Hermes readiness checks (state.db,
 * model, disk, platforms, background queues) plus this app's own turn counter.
 *
 * Failures degrade instead of 502ing the whole panel — a missing cron module
 * should not hide the disk warning next to it.
 */
export const GET: RequestHandler = () =>
	proxy(async () => {
		const [health, jobs] = await Promise.allSettled([getHealthDetailed(), listJobs()]);
		return {
			health: health.status === 'fulfilled' ? health.value : null,
			healthError: health.status === 'rejected' ? String(health.reason?.message ?? health.reason) : null,
			jobs: jobs.status === 'fulfilled' ? (jobs.value.jobs ?? []) : [],
			jobsAvailable: jobs.status === 'fulfilled',
			turns: { active: currentTurns(), limit: turnLimit() }
		};
	});
