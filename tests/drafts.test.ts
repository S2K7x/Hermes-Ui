import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
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
	restoreDraft,
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

// ---------------------------------------------------------------------------
// A turn that never started must not eat the message
// ---------------------------------------------------------------------------

test('restoreDraft hands a refused message back, in the order it was typed', () => {
	assert.equal(restoreDraft('', 'mon message'), 'mon message');
	// Whatever was typed while the creation was failing came after.
	assert.equal(restoreDraft('la suite', 'mon message'), 'mon message\n\nla suite');
	assert.equal(restoreDraft('   \n  la suite', 'mon message   '), 'mon message\n\nla suite');
});

test('restoreDraft never drops either side of the merge', () => {
	// Nothing to restore: leave the composer exactly as it is, spaces included.
	assert.equal(restoreDraft('  déjà là  ', '   '), '  déjà là  ');
	assert.equal(restoreDraft('', ''), '');
	// A blank composer is not a reason to lose the restored text.
	assert.equal(restoreDraft('   \n\n ', 'mon message'), 'mon message');
});

/**
 * The wiring, read from the sources.
 *
 * `Composer.submit()` empties itself *before* awaiting `chat.send()`, because
 * creating the conversation moves `chat.sessionId` and with it the key the
 * draft is filed under. That is correct and has to stay — but it means a turn
 * refused before it started left the text nowhere at all: not in the transcript
 * (`send()` pushes the user bubble only once it holds a session id), not in
 * localStorage (`drafts.clear`), not in the box.
 *
 * **Measured** against the built app with the gateway down — the ordinary state
 * after `systemctl --user restart hermes-gateway`, or a phone off the tailnet:
 * `POST /api/sessions` answers `502 {"code":"hermes_unreachable"}`, so
 * `newSession()` returns null and `send()` bails. These two guards fail if the
 * return value that makes the message recoverable disappears again.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('send() reports a turn that never started', () => {
	const source = read('../src/lib/stores/chat.svelte.ts');
	const start = source.indexOf('async send(');
	assert.notEqual(start, -1, 'send() not found');
	const body = source.slice(start, source.indexOf('async #consume(', start));
	assert.match(
		source.slice(start, start + 200),
		/async send\([^)]*\): Promise<boolean>/s,
		'send() must declare what it returns: the composer branches on it'
	);
	// The session-creation failure is the unambiguous one — nothing was sent and
	// nothing was rendered.
	assert.match(body, /if \(!id\) return false;/, 'a refused conversation must report false');
	assert.match(body, /\n\t\treturn true;\n\t\}/, 'a started turn must report true');
});

test('the composer puts a refused message back', () => {
	const source = read('../src/lib/components/Composer.svelte');
	assert.match(
		source,
		/if \(!\(await chat\.send\(payload, files\)\)\) restore\(/,
		'submit() must act on a turn that never started, or the text is deleted'
	);
	assert.match(source, /restoreDraft\(/, 'the merge rule lives in $lib/drafts, tested above');
	// Appending text meant for one conversation onto another is the swap
	// per-conversation drafts exist to prevent.
	assert.match(
		source,
		/if \(from === boundId\)/,
		'the restore must only touch the composer the text was typed in'
	);
});
