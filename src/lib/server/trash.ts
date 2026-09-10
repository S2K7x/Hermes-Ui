import { deleteSession, getSession, HermesError } from './hermes';
import { forgetSession, trashedSessions } from './db';
import { expiredTrash, TRASH_DAYS } from '$lib/trash';
import type { HermesSession } from '$lib/types';

/**
 * The half of the recycle bin that actually destroys something.
 *
 * Everything else about the bin is a flag on our own row (see
 * `src/lib/trash.ts`); this is where the grace period runs out and
 * `DELETE /api/sessions/{id}` is finally called on the gateway.
 */

/** Upper bound on the bin fan-out: one upstream round-trip per row. */
const PROBE_LIMIT = 60;
/** How many probes run at once. Small: these land on a Pi, in SQLite. */
const PROBE_CONCURRENCY = 6;
/** How many conversations one sweep may destroy. */
const SWEEP_LIMIT = 5;
/** A sweep this often is plenty for a thirty-day deadline. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

let lastSweep = 0;

/**
 * Delete for real whatever has sat in the bin past its deadline.
 *
 * Called off the back of a sidebar refresh — this app has no scheduler of its
 * own, and a listing is the one request that happens whenever anyone is
 * looking. Three things keep that from being a bad idea:
 *
 * - it is throttled to once an hour, so the common case is a timestamp
 *   comparison and nothing else;
 * - it is bounded to `SWEEP_LIMIT` deletes, so a bin with fifty expired rows
 *   costs the same as one with five, and the rest go on the next pass;
 * - **it never propagates a failure**. The sidebar must render whether or not
 *   the gateway feels like deleting today; an unswept conversation is a row
 *   that lives one refresh longer than promised, which harms nobody.
 *
 * A 404 counts as success: something else already deleted it, and the index
 * entry should go with it.
 */
export async function sweepTrash(now: number = Date.now() / 1000): Promise<number> {
	const wall = Date.now();
	if (wall - lastSweep < SWEEP_INTERVAL_MS) return 0;
	lastSweep = wall;

	let swept = 0;
	try {
		for (const id of expiredTrash(trashedSessions(), now, SWEEP_LIMIT, TRASH_DAYS)) {
			try {
				await deleteSession(id);
				forgetSession(id);
				swept += 1;
			} catch (err) {
				if (err instanceof HermesError && err.status === 404) {
					forgetSession(id);
					swept += 1;
				}
				// Anything else: leave the row alone and try again next hour.
			}
		}
	} catch {
		/* the bin is never worth a failed sidebar */
	}
	return swept;
}

/**
 * Rebuild the bin's contents.
 *
 * The conversations are still upstream and still perfectly listable — nothing
 * was done to them — but `GET /api/sessions` is filtered against the bin, so
 * they are fetched one at a time by id, exactly like the archived view. An id
 * that comes back 404 was deleted somewhere else (the CLI, Telegram) and is
 * dropped from the index rather than shown as recoverable, because it is not.
 */
export async function listTrashedSessions(): Promise<{
	object: 'list';
	data: HermesSession[];
	truncated: boolean;
}> {
	const rows = trashedSessions().slice(0, PROBE_LIMIT);
	const found: HermesSession[] = [];

	for (let i = 0; i < rows.length; i += PROBE_CONCURRENCY) {
		const batch = await Promise.all(
			rows.slice(i, i + PROBE_CONCURRENCY).map(async (row) => {
				try {
					const { session } = await getSession(row.session_id);
					// `deleted_at` is ours: Hermes has no idea this row is in a bin.
					return { ...session, deleted_at: row.deleted_at } as HermesSession;
				} catch (err) {
					if (err instanceof HermesError && err.status === 404) forgetSession(row.session_id);
					return null;
				}
			})
		);
		for (const session of batch) if (session) found.push(session);
	}

	return {
		object: 'list',
		data: found,
		truncated: trashedSessions().length > PROBE_LIMIT
	};
}
