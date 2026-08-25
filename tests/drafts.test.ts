import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
	DRAFT_TTL_MS,
	MAX_DRAFTS,
	MAX_DRAFT_CHARS,
	MAX_TOTAL_CHARS,
	NEW_DRAFT_KEY,
	clearDraft,
	draftKey,
	draftPreview,
	draftText,
	hasDraft,
	normalizeDrafts,
	renameDraft,
	setDraft,
	type DraftMap
} from '../src/lib/drafts.ts';

const NOW = 1_760_000_000_000;

test('draftKey falls back to the welcome-screen key', () => {
	assert.equal(draftKey('sess-1'), 'sess-1');
	assert.equal(draftKey(null), NEW_DRAFT_KEY);
	assert.equal(draftKey(undefined), NEW_DRAFT_KEY);
	assert.equal(draftKey(''), NEW_DRAFT_KEY);
});

test('setDraft stores, reads back and stamps', () => {
	const map = setDraft({}, 'a', 'bonjour', NOW);
	assert.equal(draftText(map, 'a'), 'bonjour');
	assert.equal(map.a.at, NOW);
	assert.equal(hasDraft(map, 'a'), true);
	assert.equal(hasDraft(map, 'b'), false);
	assert.equal(draftText(map, 'b'), '');
});

test('an empty or blank composer is not a draft, and clears the stored one', () => {
	const map = setDraft({}, 'a', 'bonjour', NOW);
	assert.equal(hasDraft(setDraft(map, 'a', '', NOW), 'a'), false);
	assert.equal(hasDraft(setDraft(map, 'a', '   \n\t ', NOW), 'a'), false);
	// Nothing stored, nothing to clear: the very same object comes back, which
	// is what lets the store skip a pointless localStorage write.
	const empty: DraftMap = {};
	assert.equal(setDraft(empty, 'a', '', NOW), empty);
});

test('clearDraft returns the same map when there is nothing to remove', () => {
	const map: DraftMap = { a: { text: 'x', at: NOW } };
	assert.equal(clearDraft(map, 'b'), map);
	assert.equal(hasDraft(clearDraft(map, 'a'), 'a'), false);
	// The input is never mutated.
	assert.equal(hasDraft(map, 'a'), true);
});

test('a draft too large to store is dropped rather than truncated', () => {
	const huge = 'x'.repeat(MAX_DRAFT_CHARS + 1);
	const map = setDraft(setDraft({}, 'a', 'court', NOW), 'a', huge, NOW + 1);
	// Not truncated to MAX_DRAFT_CHARS, and not left holding the stale short
	// version either: a draft that came back shortened would be sent shortened.
	assert.equal(hasDraft(map, 'a'), false);
});

test('the map is capped by count, and never evicts the draft being typed', () => {
	let map: DraftMap = {};
	for (let i = 0; i < MAX_DRAFTS + 5; i++) map = setDraft(map, `s${i}`, `texte ${i}`, NOW + i);
	assert.equal(Object.keys(map).length, MAX_DRAFTS);
	// Newest kept, oldest dropped.
	assert.equal(hasDraft(map, `s${MAX_DRAFTS + 4}`), true);
	assert.equal(hasDraft(map, 's0'), false);

	// Re-typing into the oldest surviving conversation keeps it, not drops it.
	const oldest = Object.entries(map).sort((a, b) => a[1].at - b[1].at)[0][0];
	map = setDraft(map, oldest, 'ré-écrit', NOW + 10_000);
	assert.equal(draftText(map, oldest), 'ré-écrit');
	assert.equal(Object.keys(map).length, MAX_DRAFTS);
});

test('the map is capped by total size, keeping the newest that fit', () => {
	const big = 'y'.repeat(50_000);
	let map: DraftMap = {};
	map = setDraft(map, 'a', big, NOW);
	map = setDraft(map, 'b', big, NOW + 1);
	map = setDraft(map, 'c', big, NOW + 2);
	const total = Object.values(map).reduce((n, d) => n + d.text.length, 0);
	assert.ok(total <= MAX_TOTAL_CHARS, `total ${total}`);
	assert.equal(hasDraft(map, 'c'), true);
	assert.equal(hasDraft(map, 'a'), false);
	// A small one still fits in the leftover room, even though it is older.
	map = setDraft(map, 'd', 'court', NOW + 3);
	assert.equal(hasDraft(map, 'd'), true);
	assert.equal(hasDraft(map, 'c'), true);
});

test('normalizeDrafts repairs anything localStorage may hold', () => {
	assert.deepEqual(normalizeDrafts(null, NOW), {});
	assert.deepEqual(normalizeDrafts('nope', NOW), {});
	assert.deepEqual(normalizeDrafts([1, 2], NOW), {});
	assert.deepEqual(
		normalizeDrafts(
			{
				ok: { text: 'garde-moi', at: NOW },
				noText: { at: NOW },
				blank: { text: '   ', at: NOW },
				notObject: 'x',
				nullish: null,
				badStamp: { text: 'sans date' },
				huge: { text: 'z'.repeat(MAX_DRAFT_CHARS + 1), at: NOW }
			},
			NOW
		),
		{ ok: { text: 'garde-moi', at: NOW } }
	);
});

test('normalizeDrafts expires stale drafts but keeps a clock that moved back', () => {
	const raw = {
		fresh: { text: 'a', at: NOW - 1000 },
		stale: { text: 'b', at: NOW - DRAFT_TTL_MS - 1 },
		future: { text: 'c', at: NOW + 86_400_000 }
	};
	const map = normalizeDrafts(raw, NOW);
	assert.equal(hasDraft(map, 'fresh'), true);
	assert.equal(hasDraft(map, 'stale'), false);
	assert.equal(hasDraft(map, 'future'), true);
});

test('normalizeDrafts applies the same caps as a write', () => {
	const raw: Record<string, { text: string; at: number }> = {};
	for (let i = 0; i < MAX_DRAFTS + 10; i++) raw[`s${i}`] = { text: `t${i}`, at: NOW + i };
	assert.equal(Object.keys(normalizeDrafts(raw, NOW)).length, MAX_DRAFTS);
});

test('renameDraft follows a compressed conversation onto its new id', () => {
	const map = setDraft({}, 'root', 'à envoyer', NOW);
	const moved = renameDraft(map, 'root', 'tip');
	assert.equal(draftText(moved, 'tip'), 'à envoyer');
	assert.equal(hasDraft(moved, 'root'), false);
});

test('renameDraft is a no-op when there is nothing to move, or a clash', () => {
	const map = setDraft(setDraft({}, 'root', 'ancien', NOW), 'tip', 'récent', NOW + 1);
	// The destination already holds typing: it is the more recent, keep it.
	assert.equal(renameDraft(map, 'root', 'tip'), map);
	assert.equal(renameDraft(map, 'absent', 'tip'), map);
	assert.equal(renameDraft(map, 'root', 'root'), map);
});

test('draftPreview flattens whitespace and ellipsises', () => {
	assert.equal(draftPreview('  bonjour \n  le   monde '), 'bonjour le monde');
	assert.equal(draftPreview(''), '');
	assert.equal(draftPreview('abcdef', 4), 'abc…');
	assert.equal(draftPreview('abcd', 4), 'abcd');
});
