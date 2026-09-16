import type { RequestHandler } from './$types';
import { modelOptions } from '$lib/server/catalog';
import { proxy } from '$lib/server/respond';

/**
 * Real provider/model list. /v1/models only advertises the virtual
 * "hermes-agent" name, which is not a usable model id — see hermes.ts.
 *
 * Served from the in-memory catalogue rather than straight from the gateway:
 * upstream this call reprobes the current custom provider every time and costs
 * 134 ms warm, 2.7 s cold (see `server/catalog.ts`).
 */
export const GET: RequestHandler = () => proxy(modelOptions);
