/**
 * In-flight agent turns, decoupled from the browser connection.
 *
 * Why this exists: the SSE relay used to abort the upstream fetch the moment
 * the browser went away, which meant the server never learned how the turn
 * ended. But a Sessions API turn cannot be interrupted (CLAUDE.md §2 — a turn
 * whose client left at 6 s still ran its tools and persisted its answer ~25 s
 * later), so aborting bought nothing and cost the one thing worth having: the
 * answer, at the moment it lands, while the user is elsewhere.
 *
 * So the server owns the turn now. It starts it, reads the upstream stream to
 * its terminal event no matter who is listening, mirrors it to the browser for
 * as long as one is attached, and — if nobody saw the end — sends a push
 * notification.
 *
 * The registry is process-local. A restart loses in-flight turns, which is the
 * same guarantee as before: the agent still finishes, the answer is still in
 * `state.db`, only the notification is lost.
 */

import { MAX_TURN_MS } from './config';
import { getSession } from './hermes';
import { pushToAll } from './push';
import { cachedTitle } from './db';
import { newSSEState, parseSSEChunk } from '$lib/sse';
import {
	applyTurnFrame,
	newTurnSummary,
	shouldNotifyTurn,
	type Presence,
	type TurnSummary
} from '$lib/turns';
import { turnNotification } from '$lib/push';

interface InFlightTurn {
	sessionId: string;
	/** Set while a browser is reading; null once it detaches. */
	listener: ReadableStreamDefaultController<Uint8Array> | null;
	summary: TurnSummary;
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

/**
 * Last thing the app said about being on screen.
 *
 * Single-user application, so a single global is the honest model: there is no
 * second person whose attention we could confuse this with. It exists because
 * "still attached to the stream" is a good signal on iOS (the OS suspends the
 * PWA and the socket dies) but a bad one on a desktop, where a background tab
 * keeps reading happily.
 */
let presence: Presence | null = null;

export function reportPresence(visible: boolean): void {
	presence = { visible, at: Date.now() / 1000 };
}

// ---------------------------------------------------------------------------
// The turn itself
// ---------------------------------------------------------------------------

export interface BeginTurnOptions {
	sessionId: string;
	/** Upstream SSE response — must be ok and have a body. */
	upstream: Response;
	/** Aborts the upstream fetch; fired when the turn is over or overruns. */
	abort: AbortController;
	/** Releases the concurrency slot. Called exactly once. */
	release: () => void;
	/**
	 * May this turn raise a notification? False for non-browser callers — the
	 * deploy smoke test runs a real turn, and nobody wants that on a lock
	 * screen at 5 a.m.
	 */
	notifiable: boolean;
}

/**
 * Take ownership of an upstream turn and return the stream for the browser.
 *
 * Cancelling the returned stream (tab closed, "detach" button, navigation)
 * only detaches the listener — the pump keeps reading upstream.
 */
export function beginTurn(options: BeginTurnOptions): ReadableStream<Uint8Array> {
	const turn: InFlightTurn = {
		sessionId: options.sessionId,
		listener: null,
		summary: newTurnSummary()
	};
	// Nothing else would ever end a stalled turn now that the browser cannot:
	// no timeout on the fetch (an agent turn legitimately runs for minutes) and
	// no client disconnect to fall back on.
	const deadline = setTimeout(() => options.abort.abort(), MAX_TURN_MS);

	const stream = new ReadableStream<Uint8Array>(
		{
			start(controller) {
				turn.listener = controller;
			},
			cancel() {
				turn.listener = null;
			}
		},
		// Byte-counting so `desiredSize` in `forward()` means bytes queued and
		// not frames queued; the default strategy counts chunks.
		new ByteLengthQueuingStrategy({ highWaterMark: 64 * 1024 })
	);

	void pump(turn, options).finally(() => {
		clearTimeout(deadline);
		options.release();
	});

	return stream;
}

/**
 * Drain the upstream stream to its end, mirroring it to whoever is attached.
 *
 * The read loop is driven by the upstream rather than by the browser's demand
 * on purpose: pulling only when the client asks would stop reading Hermes the
 * moment the client left, which is the bug this whole module exists to fix.
 */
async function pump(turn: InFlightTurn, options: BeginTurnOptions): Promise<void> {
	const reader = options.upstream.body!.getReader();
	const decoder = new TextDecoder();
	const parser = newSSEState();

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			forward(turn, value);
			for (const frame of parseSSEChunk(parser, decoder.decode(value, { stream: true }))) {
				let data: Record<string, unknown>;
				try {
					data = JSON.parse(frame.data);
				} catch {
					continue; // a malformed frame must not kill the turn
				}
				applyTurnFrame(turn.summary, frame.event, data);
			}
		}
	} catch {
		// Upstream died or the deadline fired. The transcript is still Hermes'
		// business; ours is to stop cleanly.
	} finally {
		reader.cancel().catch(() => {});
		options.abort.abort();
		const attached = turn.listener !== null;
		closeListener(turn);
		if (options.notifiable) await maybeNotify(turn, attached);
	}
}

/** Mirror bytes to the browser, dropping it rather than buffering forever. */
function forward(turn: InFlightTurn, chunk: Uint8Array): void {
	const controller = turn.listener;
	if (!controller) return;
	try {
		controller.enqueue(chunk);
		// A client that has stopped reading (a phone that went to sleep without
		// closing the socket) would otherwise grow this queue for the length of
		// the turn. Past a megabyte, treat it as gone — it will reload.
		if (controller.desiredSize !== null && controller.desiredSize < -1_000_000) {
			turn.listener = null;
			controller.close();
		}
	} catch {
		turn.listener = null;
	}
}

/**
 * Let the browser's reader finish.
 *
 * Deliberately without a synthetic terminal frame: a stream that ends without
 * one is exactly what the client reads as "truncated", which is the wording
 * and the "Recharger" affordance the UI already has for this case.
 */
function closeListener(turn: InFlightTurn): void {
	const controller = turn.listener;
	turn.listener = null;
	if (!controller) return;
	try {
		controller.close();
	} catch {
		/* already closed by the client */
	}
}

/**
 * Send the "your answer is ready" notification, if nobody was watching.
 *
 * A turn whose stream was cut short — truncated upstream, or stopped by
 * MAX_TURN_MS — notifies nothing: we do not know what Hermes said, and "maybe
 * something is ready" is worse than silence. The transcript still gets it.
 */
async function maybeNotify(turn: InFlightTurn, attached: boolean): Promise<void> {
	if (!turn.summary.completed && !turn.summary.error) return;
	if (!shouldNotifyTurn({ attached, presence, now: Date.now() / 1000 })) return;

	let sessionTitle = cachedTitle(turn.sessionId);
	if (!sessionTitle) {
		// Worth one loopback call: the title is what makes the notification
		// recognisable on a lock screen.
		sessionTitle = await getSession(turn.sessionId)
			.then((res) => res.session?.title ?? null)
			.catch(() => null);
	}

	await pushToAll(
		turnNotification({
			sessionId: turn.sessionId,
			sessionTitle,
			text: turn.summary.text,
			error: turn.summary.error
		})
	).catch(() => undefined);
}
