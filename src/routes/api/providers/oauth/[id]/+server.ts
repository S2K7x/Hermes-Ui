import type { RequestHandler } from './$types';
import { gate } from '$lib/server/respond';
import { dashboardResponse, disconnectOauth, startOauth } from '$lib/server/dashboard';

/**
 * Start a login.
 *
 * A provider whose `flow` is `external` answers 400 with the CLI command to
 * run — a real answer the panel shows, since a third-party CLI owns those
 * credentials and no browser flow can replace it.
 */
export const POST: RequestHandler = async ({ params }) => {
	const limited = gate('providers-oauth', 0.5, 4);
	if (limited) return limited;
	return dashboardResponse(() => startOauth(params.id));
};

/** Log a provider out. Upstream refuses (400) for CLI-owned credentials. */
export const DELETE: RequestHandler = async ({ params }) => {
	const limited = gate('providers-oauth', 0.5, 4);
	if (limited) return limited;
	return dashboardResponse(() => disconnectOauth(params.id));
};
