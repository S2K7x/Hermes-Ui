import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Liveness probe for the container healthcheck. Deliberately unauthenticated
 *  and independent of Hermes — it answers "is the web app up", nothing more. */
export const GET: RequestHandler = () => json({ status: 'ok' });
