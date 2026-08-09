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
`);

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

const selKnown = db.prepare('SELECT session_id FROM session_meta ORDER BY updated_at DESC LIMIT ?');

export const knownSessionIds = (limit: number): string[] =>
	(selKnown.all(limit) as Array<{ session_id: string }>).map((row) => row.session_id);

export default db;
