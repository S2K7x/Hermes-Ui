/**
 * A component fetched the first time it is actually needed.
 *
 * The seven settings panels are, together, the bulk of the page bundle — and
 * none of them is on screen when the app opens. Importing them statically
 * means the Pi downloads, parses and compiles every one of them before the
 * first message can be painted, for a user who may never open a single one.
 *
 * `load()` is idempotent and safe to call from an effect: the import fires
 * once, and a failed import resets so the next open can try again. The chunks
 * are part of the shell the service worker precaches, so after the first visit
 * opening a panel is a cache hit rather than a round trip — the same bargain
 * as the highlight.js split (point 9 of CLAUDE.md).
 */
export function lazyComponent<C>(load: () => Promise<{ default: C }>) {
	let value = $state<C | null>(null);
	let pending: Promise<void> | null = null;

	return {
		/** The component once it has arrived, `null` until then. */
		get current() {
			return value;
		},
		/** Start (or join) the fetch. Rejects if the chunk cannot be loaded. */
		load(): Promise<void> {
			if (value) return Promise.resolve();
			pending ??= load()
				.then((module) => {
					value = module.default;
				})
				.catch((error) => {
					pending = null;
					throw error;
				});
			return pending;
		}
	};
}
