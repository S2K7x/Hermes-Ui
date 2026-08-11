import type { RequestHandler } from './$types';
import { sessionChatStream } from '$lib/server/hermes';
import { sseErrorResponse, sseHeaders } from '$lib/server/sse';
import { beginTurn } from '$lib/server/turns';
import { releaseTurn, tryAcquireTurn, turnLimit } from '$lib/server/limits';
import { AppErrorCode } from '$lib/errors';

/**
 * SSE relay for one agent turn.
 *
 * The browser's connection no longer governs the turn: `beginTurn` reads the
 * upstream stream to its end whatever happens and mirrors it here while the
 * client is attached (see `src/lib/server/turns.ts`). Closing this response
 * therefore detaches the display, exactly as it always did from the user's
 * point of view — but the server now learns how the turn ended and can notify.
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
	// upstream's default of 10 concurrent runs. The slot is now held for the
	// whole turn, not only while a browser watches it.
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

	// Deliberately NOT wired to `request.signal`: a client that goes away must
	// not stop the turn, which would defeat the point of following it.
	const abort = new AbortController();

	try {
		const upstream = await sessionChatStream(
			params.id,
			{ message: body.message, system_message: body.system_message },
			abort.signal
		);
		if (!upstream.ok || !upstream.body) {
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
			release();
			return sseErrorResponse(message, upstream.status || 502, code);
		}

		const stream = beginTurn({
			sessionId: params.id,
			upstream,
			abort,
			release,
			// Browsers always send Origin on a POST (same invariant the origin
			// check in hooks.server.ts relies on), so its absence means a
			// script — curl, the deploy smoke test — and not someone waiting.
			notifiable: Boolean(request.headers.get('origin'))
		});
		const headers = new Headers(sseHeaders());
		const sid = upstream.headers.get('X-Hermes-Session-Id');
		if (sid) headers.set('X-Hermes-Session-Id', sid);
		return new Response(stream, { status: 200, headers });
	} catch (err) {
		release();
		const message = err instanceof Error ? err.message : String(err);
		return sseErrorResponse(`Hermes injoignable : ${message}`, 502, AppErrorCode.Unreachable);
	}
};
