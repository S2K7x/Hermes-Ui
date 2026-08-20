/**
 * What the three upstream clients have in common.
 *
 * The gateway (`hermes.ts`), the dashboard (`dashboard.ts`) and the skills
 * directory (`skills.ts`) are three unrelated things — two HTTP servers with
 * their own secret, and a bind mount. But a route treats a failure from any of
 * them identically: a status, a code, and a message already written for a
 * person. Each of the three used to carry its own copy of that error class, of
 * the read-only retry loop and of the try/catch that shapes the result into a
 * JSON response, and the copies had already drifted — one answered `null` for
 * an empty result where another answered an empty body, and one took
 * `(status, code, message)` where the others took `(status, message, code)`.
 *
 * This module imports nothing, so the three clients and `respond.ts` can all
 * depend on it and `tests/upstream.test.ts` can run it straight through the
 * type stripper.
 */

/**
 * A failure from something this app talks to but does not own.
 *
 * Subclasses exist only so a route can tell *which* upstream failed
 * (`err instanceof HermesError`); everything a response needs is here.
 */
export class UpstreamError extends Error {
	readonly status: number;
	readonly code?: string;
	/** Seconds upstream asked us to wait, when it said so. */
	readonly retryAfter?: number;

	constructor(status: number, message: string, code?: string, retryAfter?: number) {
		super(message);
		this.name = 'UpstreamError';
		this.status = status;
		this.code = code;
		this.retryAfter = retryAfter;
	}

	/**
	 * Would replaying the exact same call plausibly succeed?
	 *
	 * `status >= 500` and nothing else, deliberately. The codes the clients
	 * mint for themselves — a timeout, an unreachable host — always come with
	 * 504 and 502, so they are already covered; and neither upstream ever
	 * answers one of those codes with a 4xx (checked against api_server.py
	 * 0.20.0). A 429 is NOT transient here: being told to slow down is not a
	 * reason to knock again, and `limits.ts` is what answers that.
	 */
	get transient(): boolean {
		return this.status >= 500;
	}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
	/** Total number of tries, not extra ones: `1` means "do not retry". */
	attempts?: number;
	/** First backoff step, doubled on each further try. */
	baseDelayMs?: number;
}

/**
 * Run `fn`, replaying it while it fails transiently.
 *
 * Reads only, and opt-in at every call site: replaying a POST that created a
 * session or started an agent turn would duplicate the work. The backoff is
 * short because both upstreams sit on loopback — a slow retry helps nobody.
 */
export async function retrying<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
	const attempts = Math.max(1, opts.attempts ?? 1);
	const baseDelayMs = opts.baseDelayMs ?? 150;
	let lastError: unknown;

	for (let attempt = 0; attempt < attempts; attempt++) {
		if (attempt > 0) await sleep(baseDelayMs * 2 ** (attempt - 1));
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			const transient = err instanceof UpstreamError && err.transient;
			if (!transient || attempt === attempts - 1) throw err;
		}
	}
	throw lastError;
}
