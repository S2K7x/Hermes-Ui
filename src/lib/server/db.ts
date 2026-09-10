import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { WEB_DB_PATH } from './config';

/**
 * Local SQLite for UI-only state: preferences and a title cache.
 *
 * Chat history is NOT stored here — Hermes owns it in ~/.hermes/state.db and
 * duplicating it would guarantee drift. Put this file on the SSD alongside
 * state.db; frequent SQLite writes destroy SD cards.
 */

const path = resolve(WEB_DB_PATH);
mkdirSync(dirname(path), { recursive: true });

const db = new Database(path);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
	CREATE TABLE IF NOT EXISTS prefs (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS session_meta (
		session_id  TEXT PRIMARY KEY,
		title_cache TEXT,
		updated_at  REAL NOT NULL
	);
	CREATE TABLE IF NOT EXISTS push_subscriptions (
		endpoint   TEXT PRIMARY KEY,
		p256dh     TEXT NOT NULL,
		auth       TEXT NOT NULL,
		label      TEXT NOT NULL DEFAULT '',
		created_at REAL NOT NULL,
		last_ok_at REAL,
		last_error TEXT
	);
`);

/**
 * `deleted_at` is what makes deletion reversible.
 *
 * Nothing is sent upstream when a conversation is thrown away: the row simply
 * stops being listed here, and the real `DELETE /api/sessions/{id}` waits for
 * the sweep thirty days later. See `src/lib/trash.ts` for why that is the only
 * honest way to build this on an API whose delete is final.
 *
 * It runs before the first `db.prepare` below on purpose: better-sqlite3
 * compiles a statement as it is prepared, so a query naming this column would
 * throw at import time on a database created before it existed.
 */
const metaColumns = db.prepare('PRAGMA table_info(session_meta)').all() as Array<{ name: string }>;
if (!metaColumns.some((c) => c.name === 'deleted_at')) {
	db.exec('ALTER TABLE session_meta ADD COLUMN deleted_at REAL');
}

const selPref = db.prepare<[string], { value: string }>('SELECT value FROM prefs WHERE key = ?');
const upsertPref = db.prepare(
	'INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
const allPrefs = db.prepare('SELECT key, value FROM prefs');

export function getPref<T = unknown>(key: string, fallback: T): T {
	const row = selPref.get(key);
	if (!row) return fallback;
	try {
		return JSON.parse(row.value) as T;
	} catch {
		return fallback;
	}
}

export function setPref(key: string, value: unknown): void {
	upsertPref.run(key, JSON.stringify(value));
}

export function getAllPrefs(): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const row of allPrefs.all() as Array<{ key: string; value: string }>) {
		try {
			out[row.key] = JSON.parse(row.value);
		} catch {
			/* skip corrupt row */
		}
	}
	return out;
}

const upsertTitle = db.prepare(
	`INSERT INTO session_meta (session_id, title_cache, updated_at) VALUES (?, ?, ?)
	 ON CONFLICT(session_id) DO UPDATE SET title_cache = excluded.title_cache, updated_at = excluded.updated_at`
);
const selTitle = db.prepare<[string], { title_cache: string | null }>(
	'SELECT title_cache FROM session_meta WHERE session_id = ?'
);
const delMeta = db.prepare('DELETE FROM session_meta WHERE session_id = ?');

export const cacheTitle = (sessionId: string, title: string) =>
	upsertTitle.run(sessionId, title, Date.now() / 1000);
export const cachedTitle = (sessionId: string) => selTitle.get(sessionId)?.title_cache ?? null;
export const forgetSession = (sessionId: string) => delMeta.run(sessionId);

// ---------------------------------------------------------------------------
// Index of session ids we have ever seen
// ---------------------------------------------------------------------------

/**
 * `session_meta` doubles as the list of conversations this app knows about.
 *
 * Archiving is a one-way door in the Sessions API: `GET /api/sessions` filters
 * archived rows out and offers no flag to include them, so once a conversation
 * is archived — by this UI, by the CLI, or by Hermes' own stale sweep — there
 * is no way to enumerate it again. Recording every id we see in a listing is
 * what lets the archived view find them later, one `GET /api/sessions/{id}`
 * at a time.
 */
const rememberOne = db.prepare(
	`INSERT INTO session_meta (session_id, updated_at) VALUES (?, ?)
	 ON CONFLICT(session_id) DO NOTHING`
);
// Insert-only on purpose: refreshing the sidebar must not rewrite 200 rows
// every time. `updated_at` therefore means "first seen", which is good enough
// to order archive probes newest-first.
const rememberAll = db.transaction((ids: string[], now: number) => {
	for (const id of ids) rememberOne.run(id, now);
});

export function rememberSessions(ids: string[]): void {
	if (ids.length === 0) return;
	rememberAll(ids, Date.now() / 1000);
}

const selKnown = db.prepare(
	'SELECT session_id FROM session_meta WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?'
);

export const knownSessionIds = (limit: number): string[] =>
	(selKnown.all(limit) as Array<{ session_id: string }>).map((row) => row.session_id);

// ---------------------------------------------------------------------------
// The recycle bin
// ---------------------------------------------------------------------------

const markTrashed = db.prepare(
	`INSERT INTO session_meta (session_id, updated_at, deleted_at) VALUES (?, ?, ?)
	 ON CONFLICT(session_id) DO UPDATE SET deleted_at = excluded.deleted_at`
);
const clearTrashed = db.prepare('UPDATE session_meta SET deleted_at = NULL WHERE session_id = ?');
const selTrashed = db.prepare(
	'SELECT session_id, deleted_at FROM session_meta WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
);

/** Move a conversation to the bin. Returns when it was thrown away. */
export function trashSession(sessionId: string): number {
	const now = Date.now() / 1000;
	markTrashed.run(sessionId, now, now);
	return now;
}

/** Take it back out. Idempotent: restoring a live conversation is a no-op. */
export const restoreSession = (sessionId: string) => clearTrashed.run(sessionId);

export const trashedSessions = (): Array<{ session_id: string; deleted_at: number }> =>
	selTrashed.all() as Array<{ session_id: string; deleted_at: number }>;

/** The ids to keep out of every live listing, as a set for O(1) filtering. */
export const trashedIds = (): Set<string> =>
	new Set(trashedSessions().map((row) => row.session_id));

// ---------------------------------------------------------------------------
// Web Push subscriptions
// ---------------------------------------------------------------------------

/**
 * One row per device, not one row per user.
 *
 * A subscription is a capability URL plus two keys — knowing the endpoint is
 * enough to push to that device — so it never leaves the server: the settings
 * panel is given a digest of the endpoint as an id, plus the push service host
 * for display.
 */
export interface PushSubscriptionRow {
	endpoint: string;
	p256dh: string;
	auth: string;
	label: string;
	created_at: number;
	last_ok_at: number | null;
	last_error: string | null;
}

const upsertSub = db.prepare(
	`INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at)
	 VALUES (?, ?, ?, ?, ?)
	 ON CONFLICT(endpoint) DO UPDATE SET
	   p256dh = excluded.p256dh,
	   auth = excluded.auth,
	   label = excluded.label,
	   last_error = NULL`
);
const allSubs = db.prepare('SELECT * FROM push_subscriptions ORDER BY created_at ASC');
const delSub = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
const markOk = db.prepare(
	'UPDATE push_subscriptions SET last_ok_at = ?, last_error = NULL WHERE endpoint = ?'
);
const markError = db.prepare('UPDATE push_subscriptions SET last_error = ? WHERE endpoint = ?');

export function savePushSubscription(sub: {
	endpoint: string;
	p256dh: string;
	auth: string;
	label: string;
}): void {
	upsertSub.run(sub.endpoint, sub.p256dh, sub.auth, sub.label, Date.now() / 1000);
}

export const listPushSubscriptions = (): PushSubscriptionRow[] =>
	allSubs.all() as PushSubscriptionRow[];

export const deletePushSubscription = (endpoint: string): boolean =>
	delSub.run(endpoint).changes > 0;

export const markPushDelivered = (endpoint: string) => markOk.run(Date.now() / 1000, endpoint);
export const markPushFailed = (endpoint: string, error: string) =>
	markError.run(error.slice(0, 200), endpoint);

export default db;
