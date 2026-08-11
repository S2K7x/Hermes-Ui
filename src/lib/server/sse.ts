/**
 * SSE response plumbing for the turn endpoint.
 *
 * The relay itself moved to `src/lib/server/turns.ts`, because forwarding the
 * bytes turned out to be the easy half: what matters is that the server keeps
 * reading Hermes after the browser leaves. A Sessions API turn cannot be
 * interrupted anyway (CLAUDE.md §2 — `/v1/runs/{id}/stop` only knows runs
 * submitted through `POST /v1/runs`, and dropping the SSE socket does not
 * cancel the run: measured, a turn cut at 6 s still ran its three tool calls
 * and persisted its answer ~25 s later). Since the work happens regardless,
 * following it to the end is free, and it is what makes a notification
 * possible. The UI still calls this "detaching", never "stopping".
 *
 * What stays here is the header set and the error envelope, both of which the
 * route needs before any turn exists.
 */

const SSE_HEADERS: Record<string, string> = {
	'Content-Type': 'text/event-stream; charset=utf-8',
	'Cache-Control': 'no-cache, no-transform',
	Connection: 'keep-alive',
	// Tells nginx/Caddy (if one is interposed to rewrite the Host header) not
	// to buffer. Tailscale Serve flushes text/event-stream on its own.
	'X-Accel-Buffering': 'no'
};

/** A fresh copy of the SSE response headers. */
export const sseHeaders = (): Record<string, string> => ({ ...SSE_HEADERS });

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
