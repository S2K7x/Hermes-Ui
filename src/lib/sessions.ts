import type { HermesSession } from './types';

/** Seconds-since-epoch of the last activity on a session. */
export const activityAt = (s: HermesSession): number => s.last_active || s.started_at || 0;

export function sessionLabel(s: HermesSession): string {
	const title = s.title?.trim();
	if (title) return title;
	const preview = s.preview?.trim();
	if (preview) return preview.length > 48 ? `${preview.slice(0, 47)}…` : preview;
	return 'Sans titre';
}

/** Short relative time for a sidebar row. */
export function relativeTime(ts: number, now: Date = new Date()): string {
	if (!ts) return '';
	const date = new Date(ts * 1000);
	const days = daysAgo(ts, now);
	if (days === 0) return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	if (days === 1) return 'hier';
	if (days < 7) return `${days} j`;
	return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/**
 * The local calendar day a moment falls on, as a count of days since the
 * epoch. Going through `Date.UTC` on the *local* year/month/day is what makes
 * the subtraction below exact: UTC days are always 86 400 s, whereas the local
 * days being compared are not. Subtracting two wall-clock instants and dividing
 * by 86 400 000 — the obvious version — is off by one across every daylight
 * saving change, in both directions.
 */
const localDay = (d: Date): number =>
	Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;

/**
 * Whole calendar days between a timestamp and now: 0 today, 1 yesterday.
 *
 * Counted in days, not in elapsed time, because that is what the labels mean —
 * something from 23:50 yesterday is "hier" ten minutes later, and something
 * from this morning stays "today" all evening. A timestamp in the future
 * (clock skew between the Pi and Hermes) reads as today rather than negative.
 */
function daysAgo(ts: number, now: Date = new Date()): number {
	const days = localDay(now) - localDay(new Date(ts * 1000));
	return days > 0 ? days : 0;
}

export interface SessionGroup {
	key: string;
	label: string;
	sessions: HermesSession[];
}

/**
 * Bucket sessions the way Claude.ai and ChatGPT do: pinned first, then by
 * recency band. Bands with nothing in them are dropped so the sidebar never
 * shows an empty heading.
 */
export function groupSessions(sessions: HermesSession[], now: Date = new Date()): SessionGroup[] {
	const sorted = [...sessions].sort((a, b) => activityAt(b) - activityAt(a));

	const bands: SessionGroup[] = [
		{ key: 'pinned', label: 'Épinglées', sessions: [] },
		{ key: 'today', label: "Aujourd'hui", sessions: [] },
		{ key: 'yesterday', label: 'Hier', sessions: [] },
		{ key: 'week', label: '7 derniers jours', sessions: [] },
		{ key: 'month', label: '30 derniers jours', sessions: [] },
		{ key: 'older', label: 'Plus ancien', sessions: [] }
	];
	const byKey = Object.fromEntries(bands.map((b) => [b.key, b]));

	for (const session of sorted) {
		if (session.pinned) {
			byKey.pinned.sessions.push(session);
			continue;
		}
		const days = daysAgo(activityAt(session), now);
		if (days === 0) byKey.today.sessions.push(session);
		else if (days === 1) byKey.yesterday.sessions.push(session);
		else if (days < 7) byKey.week.sessions.push(session);
		else if (days < 30) byKey.month.sessions.push(session);
		else byKey.older.sessions.push(session);
	}

	return bands.filter((b) => b.sessions.length > 0);
}

/** Case- and accent-insensitive substring match over title and preview. */
export function matchesQuery(session: HermesSession, query: string): boolean {
	const needle = normalize(query);
	if (!needle) return true;
	return (
		normalize(session.title ?? '').includes(needle) ||
		normalize(session.preview ?? '').includes(needle)
	);
}

// Strip combining marks so "resume" finds "résumé".
const normalize = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');

/**
 * Session ids worth probing one by one to rebuild the archived list.
 *
 * `GET /api/sessions` can never return an archived conversation: Hermes calls
 * `list_sessions_rich()` without `include_archived`, whose default is False,
 * and exposes no query parameter for it. Only `GET /api/sessions/{id}` reaches
 * an archived row. So the archived view is rebuilt from the ids this app has
 * already seen in a listing, minus the ones the live listing still returns —
 * whatever is left is archived, deleted, or aged past the recency window.
 *
 * `known` is expected newest-first; the cap bounds the fan-out, since each
 * candidate costs one upstream round-trip on a Pi.
 */
export function archivedCandidates(known: string[], active: string[], limit: number): string[] {
	const live = new Set(active);
	const out: string[] = [];
	for (const id of known) {
		if (out.length >= limit) break;
		if (!live.has(id)) out.push(id);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Conversations Hermes compressed under us
// ---------------------------------------------------------------------------

/** A conversation whose id moved, from the id it had to the id it answers to. */
export interface SessionRotation {
	root: string;
	tip: string;
}

/**
 * The id changes Hermes made behind the app's back in this listing.
 *
 * Context compression ends the running session and forks a continuation child
 * (`end_reason = "compression"`, linked by `parent_session_id`); new messages
 * land in the child. `list_sessions_rich` hides that from the sidebar by
 * projecting the chain forward — one logical conversation stays one row — but
 * the row then carries the **continuation's** id, with the original in
 * `_lineage_root_id`.
 *
 * Everything this app keys on a session id therefore has to follow: the agent
 * binding and the title cache in `session_meta`, and the open conversation.
 */
export function lineageRotations(sessions: HermesSession[]): SessionRotation[] {
	const out: SessionRotation[] = [];
	for (const s of sessions) {
		const root = s._lineage_root_id;
		if (root && s.id && root !== s.id) out.push({ root, tip: s.id });
	}
	return out;
}

/** What `current` has become in this listing, or null when it has not moved. */
export function rotatedSessionId(
	sessions: HermesSession[],
	current: string | null | undefined
): string | null {
	if (!current) return null;
	for (const { root, tip } of lineageRotations(sessions)) {
		if (root === current) return tip;
	}
	return null;
}

/** Compact token/cost summary for a session, or null when nothing ran yet. */
export function usageSummary(s: HermesSession | undefined): string | null {
	if (!s) return null;
	const inTok = s.input_tokens ?? 0;
	const outTok = s.output_tokens ?? 0;
	if (!inTok && !outTok) return null;
	const cost = s.actual_cost_usd ?? s.estimated_cost_usd ?? 0;
	const tokens = `${fmtTokens(inTok)} ↓ / ${fmtTokens(outTok)} ↑`;
	return cost > 0 ? `${tokens} · $${cost.toFixed(4)}` : tokens;
}

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
