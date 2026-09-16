import { getModelOptions } from './hermes';
import { cachedRead } from './cache';

/**
 * The provider/model inventory, kept in memory between requests.
 *
 * It is read on two paths, and it was the slowest call on both:
 *
 * - the boot fan-out, where `chat.init()` starts it without awaiting it
 *   (CLAUDE.md §26) — so it never blocked the transcript, but it did spend
 *   134 ms of the Pi's time, or 2.7 s once an hour, on a list nobody asked to
 *   see;
 * - `POST /api/sessions`, which resolves the gateway's default model before
 *   creating a conversation. That one *is* on the critical path: it runs
 *   between pressing Enter on the first message and the turn starting.
 *
 * Five minutes of freshness, then stale-while-revalidate. Anything this app
 * does that could change the answer — a provider key written, an account
 * logged in or out, the global default model moved — goes through the
 * dashboard client, which drops this cache on the way out (see
 * `invalidateModelOptions` in `dashboard.ts`). What is left is a change made
 * from the CLI or by hand, which lands within the window.
 */
export const MODEL_OPTIONS_FRESH_MS = 5 * 60_000;

const catalogue = cachedRead(getModelOptions, { freshMs: MODEL_OPTIONS_FRESH_MS });

export const modelOptions = () => catalogue.get();

/** Forget the inventory: the next reader waits for a fresh one. */
export const invalidateModelOptions = () => catalogue.invalidate();
