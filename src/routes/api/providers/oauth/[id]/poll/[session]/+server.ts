import type { RequestHandler } from './$types';
import { gate } from '$lib/server/respond';
import { dashboardResponse, pollOauth } from '$lib/server/dashboard';

/**
 * Status of a pending login: `{status, error_message, expires_at}`, with
 * `status` in `pending | approved | denied | expired | error`.
 *
 * The rate limit is sized for the device-code interval the provider dictates
 * (5 s upstream, floored at 2 s client-side) plus room for a retry.
 */
export const GET: RequestHandler = async ({ params }) => {
	const limited = gate('providers-oauth-poll', 1, 6);
	if (limited) return limited;
	return dashboardResponse(() => pollOauth(params.id, params.session));
};
