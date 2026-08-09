import type { RequestHandler } from './$types';
import { sessionChatStream } from '$lib/server/hermes';
import { relaySSE, sseErrorResponse } from '$lib/server/sse';
import { releaseTurn, tryAcquireTurn, turnLimit } from '$lib/server/limits';
import { AppErrorCode } from '$lib/errors';

/**
 * SSE relay for one agent turn.
 *
 * Errors are reported as SSE frames rather than HTTP statuses whenever the
 * stream has (or could have) started: the client reads this endpoint with a
 * stream reader, so a bare 500 body would surface as "unexpected end of
 * stream" instead of a message. `sseErrorResponse` keeps one shape for both.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	let body: { message?: unknown; system_message?: string };
	try {
		body = await request.json();
	} catch {
		return sseErrorResponse('Corps JSON invalide.', 400, 'invalid_body');
	}
	if (body.message === undefined || body.message === null || body.message === '') {
		return sseErrorResponse('Message vide.', 400, 'missing_message');
	}

	// Local cap, checked before Hermes': a Pi 5 struggles long before the
	// upstream's default of 10 concurrent runs.
	if (!tryAcquireTurn()) {
		return sseErrorResponse(
			`Déjà ${turnLimit()} tours en cours. Attendez qu'un se termine.`,
			429,
			AppErrorCode.RateLimited
		);
	}

	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		releaseTurn();
	};

	const controller = new AbortController();
	const onAbort = () => controller.abort();
	request.signal.addEventListener('abort', onAbort);

	try {
		const upstream = await sessionChatStream(
			params.id,
			{ message: body.message, system_message: body.system_message },
			controller.signal
		);
		if (!upstream.ok) {
			// Hermes rejected the turn outright (404 session, 429 cap, 400 on a
			// bad content part). Read its JSON so the reason survives.
			const text = await upstream.text().catch(() => '');
			let message = `Hermes a refusé le tour (HTTP ${upstream.status}).`;
			let code: string | undefined;
			try {
				const parsed = JSON.parse(text);
				message = parsed?.error?.message || message;
				code = parsed?.error?.code;
			} catch {
				/* keep the generic message */
			}
			request.signal.removeEventListener('abort', onAbort);
			release();
			return sseErrorResponse(message, upstream.status, code);
		}

		return relaySSE(upstream, () => {
			request.signal.removeEventListener('abort', onAbort);
			controller.abort();
			release();
		});
	} catch (err) {
		request.signal.removeEventListener('abort', onAbort);
		release();
		const message = err instanceof Error ? err.message : String(err);
		return sseErrorResponse(`Hermes injoignable : ${message}`, 502, AppErrorCode.Unreachable);
	}
};
