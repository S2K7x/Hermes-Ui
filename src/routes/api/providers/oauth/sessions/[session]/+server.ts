import type { RequestHandler } from './$types';
import { gate } from '$lib/server/respond';
import { cancelOauthSession, dashboardResponse } from '$lib/server/dashboard';

/**
 * Abandon a pending login.
 *
 * Worth calling rather than just forgetting the session client-side: upstream
 * marks the session cancelled before dropping it, so the background
 * device-code poller stops instead of quietly completing a login the user
 * believed they had aborted.
 */
export const DELETE: RequestHandler = async ({ params }) => {
	const limited = gate('providers-oauth', 0.5, 4);
	if (limited) return limited;
	return dashboardResponse(() => cancelOauthSession(params.session));
};
