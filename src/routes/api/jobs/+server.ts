import type { RequestHandler } from './$types';
import { jobAction, listJobs } from '$lib/server/hermes';
import { proxy } from '$lib/server/respond';

export const GET: RequestHandler = () => proxy(listJobs);

export const POST: RequestHandler = async ({ request }) =>
	proxy(async () => {
		const { id, action } = (await request.json()) as {
			id: string;
			action: 'pause' | 'resume' | 'run';
		};
		return jobAction(id, action);
	});
