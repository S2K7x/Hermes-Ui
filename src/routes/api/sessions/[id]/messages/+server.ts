import type { RequestHandler } from './$types';
import { getSessionMessages } from '$lib/server/hermes';
import { proxy } from '$lib/server/respond';

export const GET: RequestHandler = ({ params, url }) => {
	const order = url.searchParams.get('order');
	return proxy(() =>
		getSessionMessages(params.id, {
			limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
			offset: url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined,
			order: order === 'oldest' || order === 'latest' ? order : undefined
		})
	);
};
