import type { RequestHandler } from './$types';
import { getModelOptions } from '$lib/server/hermes';
import { proxy } from '$lib/server/respond';

/**
 * Real provider/model list. /v1/models only advertises the virtual
 * "hermes-agent" name, which is not a usable model id — see hermes.ts.
 */
export const GET: RequestHandler = () => proxy(getModelOptions);
