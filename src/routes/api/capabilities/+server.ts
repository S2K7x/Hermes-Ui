import type { RequestHandler } from './$types';
import { getCapabilities, getHealth } from '$lib/server/hermes';
import { proxy } from '$lib/server/respond';

/** Health + feature flags in one call — the UI gates features off this. */
export const GET: RequestHandler = () =>
	proxy(async () => {
		const [health, capabilities] = await Promise.all([getHealth(), getCapabilities()]);
		return { health, capabilities };
	});
