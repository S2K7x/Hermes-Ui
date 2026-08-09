import { json } from '@sveltejs/kit';
import { HermesError } from './hermes';
import { AppErrorCode, type ApiErrorBody } from '$lib/errors';
import { allowRequest } from './limits';

function body(message: string, code?: string, retryAfter?: number): ApiErrorBody {
	return { error: { message, code, retry_after: retryAfter } };
}

export function errorResponse(
	status: number,
	message: string,
	code?: string,
	retryAfter?: number
): Response {
	const headers: Record<string, string> = {};
	if (retryAfter) headers['Retry-After'] = String(retryAfter);
	return json(body(message, code, retryAfter), { status, headers });
}

/**
 * Run a Hermes call and shape the result as a JSON response, mapping
 * HermesError onto its upstream status and code so the browser can decide
 * whether to retry, re-sync, or just tell the user.
 */
export async function proxy<T>(fn: () => Promise<T>): Promise<Response> {
	try {
		return json((await fn()) as any);
	} catch (err) {
		if (err instanceof HermesError) {
			return errorResponse(err.status, err.message, err.code, err.retryAfter);
		}
		const message = err instanceof Error ? err.message : String(err);
		return errorResponse(502, message, AppErrorCode.Unreachable);
	}
}

/**
 * Rate-limit gate for a route class. Returns a 429 response when the caller
 * should back off, or null to proceed.
 */
export function gate(key: string, perSecond: number, burst: number): Response | null {
	if (allowRequest(key, perSecond, burst)) return null;
	return errorResponse(
		429,
		'Trop de requêtes. Ralentissez un instant.',
		AppErrorCode.RateLimited,
		1
	);
}

/** Parse a JSON request body, returning a 400 response instead of throwing. */
export async function readJson<T>(request: Request): Promise<{ body: T } | { response: Response }> {
	try {
		const parsed = (await request.json()) as T;
		if (!parsed || typeof parsed !== 'object') {
			return { response: errorResponse(400, 'Le corps doit être un objet JSON.', 'invalid_body') };
		}
		return { body: parsed };
	} catch {
		return { response: errorResponse(400, 'Corps JSON invalide.', 'invalid_body') };
	}
}
