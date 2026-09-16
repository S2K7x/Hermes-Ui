/**
 * A single-flight, stale-while-revalidate cache for one upstream read.
 *
 * Not every gateway endpoint costs the same. Measured through the running
 * proxy on this Pi, three samples each: `/api/capabilities` 4–6 ms,
 * `/api/sessions?limit=200` 7–8 ms, `/api/skills` 26–72 ms — and
 * `/api/models` **134 ms warm, 2 740 ms on the first call after Hermes' own
 * hourly disk cache expired**. That endpoint is not a file read:
 * `_handle_model_options` calls `build_model_options_payload(…,
 * probe_current_custom_provider=True)`, which rebuilds the provider inventory,
 * applies pricing and *probes the current custom provider over the network* on
 * every single call.
 *
 * Nothing about that answer changes between two openings of the app, so paying
 * it again is work the Pi does for free. This keeps the last answer in memory:
 * fresh inside a window, and beyond it handed back immediately while a refresh
 * runs behind the request. The only wait left is the very first call of the
 * process.
 *
 * Deliberately in memory and not in `data/hermes-web.db`: a catalogue is
 * cheap to rebuild, and a restart is exactly when a stale one should be
 * dropped.
 */

export interface CachedRead<T> {
	/** The cached value, refreshing behind the caller when it has gone stale. */
	get(): Promise<T>;
	/** Drop it: the next read waits for a fresh answer. */
	invalidate(): void;
}

export interface CacheOptions {
	/** How long a value is served with no upstream call at all. */
	freshMs: number;
	/** Injectable clock — a cache policy cannot be tested against a real one. */
	now?: () => number;
}

export function cachedRead<T>(load: () => Promise<T>, options: CacheOptions): CachedRead<T> {
	const now = options.now ?? Date.now;
	let entry: { value: T; at: number } | null = null;
	let inFlight: Promise<T> | null = null;
	/**
	 * Bumped by `invalidate()`. A refresh that started before the invalidation
	 * carries data from before it, so it must not be allowed to install itself
	 * as the new entry — that would undo the invalidation without a trace.
	 */
	let generation = 0;

	function refresh(): Promise<T> {
		// Single flight: a boot fan-out and a new conversation asking at the
		// same moment are one upstream call, not two.
		if (inFlight) return inFlight;
		const started = generation;
		const pending = load()
			.then((value) => {
				if (started === generation) entry = { value, at: now() };
				return value;
			})
			.finally(() => {
				if (inFlight === pending) inFlight = null;
			});
		inFlight = pending;
		return pending;
	}

	return {
		get() {
			if (!entry) return refresh();
			if (now() - entry.at < options.freshMs) return Promise.resolve(entry.value);
			// Stale: answer with what we have and refresh behind the request. A
			// refresh that fails keeps the previous answer rather than emptying
			// the model picker because the gateway blinked.
			void refresh().catch(() => undefined);
			return Promise.resolve(entry.value);
		},
		invalidate() {
			entry = null;
			inFlight = null;
			generation += 1;
		}
	};
}
