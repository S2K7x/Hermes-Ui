import assert from 'node:assert/strict';
import test from 'node:test';
import {
	archivedCandidates,
	groupSessions,
	lineageRotations,
	matchesQuery,
	rotatedSessionId,
	sessionLabel,
	usageSummary
} from '../src/lib/sessions.ts';
import { ApiError, AppErrorCode, humanizeError } from '../src/lib/errors.ts';
import type { HermesSession } from '../src/lib/types.ts';

const DAY = 86_400;
const now = () => Date.now() / 1000;

const session = (over: Partial<HermesSession> = {}): HermesSession => ({
	id: over.id ?? Math.random().toString(36).slice(2),
	last_active: now(),
	...over
});

test('groups sessions into recency bands, dropping empty ones', () => {
	const groups = groupSessions([
		session({ id: 'a', last_active: now() }),
		session({ id: 'b', last_active: now() - 2 * DAY }),
		session({ id: 'c', last_active: now() - 200 * DAY })
	]);
	assert.deepEqual(
		groups.map((g) => g.key),
		['today', 'week', 'older']
	);
});

test('pinned sessions leave their recency band', () => {
	const groups = groupSessions([
		session({ id: 'old-but-pinned', last_active: now() - 400 * DAY, pinned: true }),
		session({ id: 'fresh', last_active: now() })
	]);
	assert.equal(groups[0].key, 'pinned');
	assert.deepEqual(
		groups[0].sessions.map((s) => s.id),
		['old-but-pinned']
	);
	assert.equal(groups[1].key, 'today');
});

test('sessions sort newest-first inside a band', () => {
	const [group] = groupSessions([
		session({ id: 'older', last_active: now() - 60 }),
		session({ id: 'newer', last_active: now() })
	]);
	assert.deepEqual(
		group.sessions.map((s) => s.id),
		['newer', 'older']
	);
});

test('search ignores case and accents', () => {
	const s = session({ title: 'Résumé du déploiement' });
	assert.ok(matchesQuery(s, 'resume'));
	assert.ok(matchesQuery(s, 'DÉPLOIEMENT'));
	assert.ok(!matchesQuery(s, 'facture'));
});

test('search falls back to the preview text', () => {
	assert.ok(matchesQuery(session({ preview: 'temperature du CPU' }), 'cpu'));
});

test('label falls back through title, preview, then a placeholder', () => {
	assert.equal(sessionLabel(session({ title: 'Titre' })), 'Titre');
	assert.equal(sessionLabel(session({ title: '  ', preview: 'aperçu' })), 'aperçu');
	assert.equal(sessionLabel(session({})), 'Sans titre');
});

test('usage summary appears only once tokens exist', () => {
	assert.equal(usageSummary(session({})), null);
	assert.equal(
		usageSummary(session({ input_tokens: 21_473, output_tokens: 412, estimated_cost_usd: 0.0123 })),
		'21.5k ↓ / 412 ↑ · $0.0123'
	);
});

test('known error codes get an actionable French message', () => {
	const rateLimited = new ApiError(429, 'Too many concurrent runs (max 10)', AppErrorCode.RateLimited);
	assert.match(humanizeError(rateLimited), /tours simultanés/);

	const gone = new ApiError(404, 'Session not found: x', AppErrorCode.SessionGone);
	assert.match(humanizeError(gone), /n'existe plus/);

	// 401 has no dedicated code but must still point at the real cause.
	assert.match(humanizeError(new ApiError(401, 'Unauthorized')), /HERMES_API_KEY/);
});

test('retryable classification drives the retry helper', () => {
	assert.ok(new ApiError(429, '', AppErrorCode.RateLimited).retryable);
	assert.ok(new ApiError(503, '').retryable);
	assert.ok(new ApiError(0, '', AppErrorCode.Unreachable).retryable);
	// A rejected payload will be rejected again — replaying it is pointless.
	assert.ok(!new ApiError(400, '', 'unsupported_content_type').retryable);
	assert.ok(!new ApiError(404, '', AppErrorCode.SessionGone).retryable);
});

test('archive candidates are the known ids the live listing dropped', () => {
	const known = ['e', 'd', 'c', 'b', 'a'];
	// c and a are still listed, so they are not archived.
	assert.deepEqual(archivedCandidates(known, ['c', 'a'], 10), ['e', 'd', 'b']);
	// Order follows `known`, newest-first, and the cap bounds the fan-out.
	assert.deepEqual(archivedCandidates(known, [], 2), ['e', 'd']);
	// Nothing to probe when every known session is still live.
	assert.deepEqual(archivedCandidates(known, known, 10), []);
	assert.deepEqual(archivedCandidates([], ['a'], 10), []);
	// A live id we have never recorded is simply irrelevant here.
	assert.deepEqual(archivedCandidates(['a'], ['z'], 10), ['a']);
	// A zero cap disables probing entirely rather than probing everything.
	assert.deepEqual(archivedCandidates(known, [], 0), []);
});

test('a compressed conversation reports the id it moved to', () => {
	const rows = [
		session({ id: 'plain' }),
		session({ id: 'tip-1', _lineage_root_id: 'root-1' }),
		session({ id: 'tip-2', _lineage_root_id: 'root-2' })
	];
	assert.deepEqual(lineageRotations(rows), [
		{ root: 'root-1', tip: 'tip-1' },
		{ root: 'root-2', tip: 'tip-2' }
	]);

	// An uncompressed listing has nothing to migrate.
	assert.deepEqual(lineageRotations([session({ id: 'plain' })]), []);
	// The projection only sets the field when it differs, but a row that names
	// itself as its own root is not a rotation either.
	assert.deepEqual(lineageRotations([session({ id: 'a', _lineage_root_id: 'a' })]), []);
	assert.deepEqual(lineageRotations([session({ id: 'a', _lineage_root_id: null })]), []);
	assert.deepEqual(lineageRotations([]), []);
});

test('the open conversation follows its compression continuation', () => {
	const rows = [session({ id: 'plain' }), session({ id: 'tip-1', _lineage_root_id: 'root-1' })];
	assert.equal(rotatedSessionId(rows, 'root-1'), 'tip-1');
	// Already on the continuation, or on an untouched conversation: no move.
	assert.equal(rotatedSessionId(rows, 'tip-1'), null);
	assert.equal(rotatedSessionId(rows, 'plain'), null);
	// Nothing open, or an id this listing knows nothing about.
	assert.equal(rotatedSessionId(rows, null), null);
	assert.equal(rotatedSessionId(rows, 'gone'), null);
	assert.equal(rotatedSessionId([], 'root-1'), null);
});
