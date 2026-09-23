import type { RequestHandler } from './$types';
import { skillCatalogue } from '$lib/server/catalog';
import { proxy } from '$lib/server/respond';

/**
 * What Hermes has loaded: its skills and its resolved toolsets.
 *
 * Served from the in-memory catalogue rather than straight from the gateway.
 * Upstream this is two handlers that walk the skill tree and reload
 * `config.yaml` on every call — measured at 26 ms through this proxy, the
 * slowest read of the boot fan-out now that the model list is cached — for an
 * answer that cannot change until the gateway is restarted (see
 * `server/catalog.ts`).
 */
export const GET: RequestHandler = () => proxy(skillCatalogue);
