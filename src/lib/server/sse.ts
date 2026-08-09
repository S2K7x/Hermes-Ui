/**
 * SSE relay: Hermes upstream stream -> browser.
 *
 * The bytes are forwarded untouched (Hermes already frames valid SSE and sends
 * `: keepalive` comments), so the relay is a pass-through with the right
 * response headers plus an abort bridge that releases the upstream socket when
 * the browser goes away.
 *
 * What the abort bridge does NOT do is stop the agent. A Sessions API turn
 * cannot be interrupted: `/v1/runs/{id}/stop` only knows runs submitted via
 * `POST /v1/runs` (they alone land in `_active_run_agents`), and although the
 * stream handler calls `task.cancel()` when a write fails, that never lands in
 * time — measured on this Pi, a turn whose client disconnected at 6 s still ran
 * its three tool calls and persisted its answer ~25 s later. Freeing the socket
 * is worth doing; treating it as cancellation is not. The UI reflects this by
 * marking the turn detached rather than stopped.
 */

const SSE_HEADERS: Record<string, string> = {
	'Content-Type': 'text/event-stream; charset=utf-8',
	'Cache-Control': 'no-cache, no-transform',
	Connection: 'keep-alive',
	// Tells nginx/Caddy (if one is interposed to rewrite the Host header) not
	// to buffer. Tailscale Serve flushes text/event-stream on its own.
	'X-Accel-Buffering': 'no'
};

/**
 * Report a failure inside the SSE envelope.
 *
 * The status is still set for anything reading it, but the payload is what the
 * client actually consumes — it reads this endpoint with a stream reader, so a
 * plain JSON error body would surface as a truncated stream, not a message.
 */
export function sseErrorResponse(message: string, status = 500, code?: string): Response {
	const body =
		`event: error\ndata: ${JSON.stringify({ message, code, status })}\n\n` +
		`event: done\ndata: {}\n\n`;
	return new Response(body, { status, headers: SSE_HEADERS });
}

/**
 * Wrap an upstream SSE response for the browser.
 *
 * @param upstream  the Hermes response (must have a body)
 * @param onClose   invoked once the client goes away or the stream ends
 */
export function relaySSE(upstream: Response, onClose?: () => void): Response {
	if (!upstream.ok || !upstream.body) {
		return sseErrorResponse(
			`Hermes refused the stream (HTTP ${upstream.status})`,
			upstream.status || 502
		);
	}

	const reader = upstream.body.getReader();
	let closed = false;
	const finish = () => {
		if (closed) return;
		closed = true;
		onClose?.();
	};

	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					finish();
					controller.close();
					return;
				}
				controller.enqueue(value);
			} catch (err) {
				finish();
				controller.error(err);
			}
		},
		cancel() {
			// Browser disconnected (Stop button, tab close, navigation).
			// Cancelling the reader propagates to the upstream fetch, which
			// makes Hermes cancel the agent task.
			finish();
			reader.cancel().catch(() => {});
		}
	});

	const headers = new Headers(SSE_HEADERS);
	const sid = upstream.headers.get('X-Hermes-Session-Id');
	if (sid) headers.set('X-Hermes-Session-Id', sid);
	return new Response(stream, { status: 200, headers });
}
