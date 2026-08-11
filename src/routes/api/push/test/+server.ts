import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { pushConfigured } from '$lib/server/config';
import { findByDeviceId, pushToAll, pushToDevice } from '$lib/server/push';
import { errorResponse, gate } from '$lib/server/respond';

/**
 * Send a test notification.
 *
 * This is the only way to find out whether the whole chain works — VAPID
 * identity, encryption, the push service, iOS' own delivery — without waiting
 * for an agent turn to finish while looking away.
 */
export const POST: RequestHandler = async ({ url }) => {
	const limited = gate('push-test', 0.2, 3);
	if (limited) return limited;
	if (!pushConfigured()) {
		return errorResponse(
			503,
			'Les notifications ne sont pas configurées sur le serveur.',
			'push_unavailable'
		);
	}

	const message = {
		title: 'Hermes',
		body: 'Notification de test — la chaîne fonctionne.',
		url: '/',
		tag: 'test'
	};

	const id = url.searchParams.get('id');
	if (id) {
		const row = findByDeviceId(id);
		if (!row) return errorResponse(404, 'Cet appareil n’est plus abonné.', 'device_not_found');
		const outcome = await pushToDevice(row, message);
		return json({ sent: outcome === 'sent' ? 1 : 0, failed: outcome === 'failed' ? 1 : 0, dropped: outcome === 'dropped' ? 1 : 0 });
	}

	return json(await pushToAll(message));
};
