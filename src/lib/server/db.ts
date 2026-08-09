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

export default db;
