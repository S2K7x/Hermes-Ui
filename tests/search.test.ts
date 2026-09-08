import assert from 'node:assert/strict';
import test from 'node:test';
import { MIN_QUERY_CHARS, findInMessages, type SearchableMessage } from '../src/lib/search.ts';

/**
 * Searching the open conversation.
 *
 * Two things have to hold at once: the match is found however it is accented
 * or cased, and the excerpt quotes the message **as written**. Folding the
 * text to compare it is easy; cutting the excerpt out of the original is what
 * the index map is for, and it is what these tests mostly exercise.
 */

let seq = 0;
const msg = (content: string, role: 'user' | 'assistant' = 'assistant'): SearchableMessage => ({
	id: `m${++seq}`,
	role,
	content,
	timestamp: seq
});

test('a match is found whatever the accents and the case', () => {
	const hits = findInMessages([msg('Voici le Résumé de la journée.')], 'resume');
	assert.equal(hits.length, 1);
	// Quoted as written, not as folded.
	assert.equal(hits[0].match, 'Résumé');
});

test('an accented query finds unaccented text', () => {
	const hits = findInMessages([msg('Voici le resume de la journee.')], 'résumé');
	assert.equal(hits.length, 1);
	assert.equal(hits[0].match, 'resume');
});

test('every occurrence is counted, and the excerpt is the first one', () => {
	const hits = findInMessages([msg('docker ps puis docker logs puis docker stop')], 'docker');
	assert.equal(hits.length, 1);
	assert.equal(hits[0].count, 3);
	assert.equal(hits[0].before, '');
	assert.equal(hits[0].match, 'docker');
	assert.ok(hits[0].after.startsWith(' ps puis'));
});

test('overlapping is not counted twice', () => {
	// "aaaa" contains "aa" twice without overlap, not three times.
	assert.equal(findInMessages([msg('aaaa')], 'aa')[0].count, 2);
});

test('the excerpt is one line, elided on both sides', () => {
	const long = `${'x'.repeat(200)}\n\n  cible  \n\n${'y'.repeat(200)}`;
	const hit = findInMessages([msg(long)], 'cible')[0];
	assert.ok(hit.before.startsWith('…'), 'text was cut before the match');
	assert.ok(hit.after.endsWith('…'), 'text was cut after the match');
	assert.ok(!/[\n\t]/.test(hit.before + hit.match + hit.after), 'excerpt must be one line');
	assert.ok(!/ {2}/.test(hit.before), 'blank runs are squeezed');
	assert.ok(!/ {2}/.test(hit.after), 'blank runs are squeezed');
	// The ellipsis must sit against the text, not float on a space.
	assert.ok(!/^…\s/.test(hit.before), 'nothing dangles after the leading ellipsis');
	assert.ok(!/\s…$/.test(hit.after), 'nothing dangles before the trailing ellipsis');
});

test('a match at the very start or end keeps its side unelided', () => {
	const hit = findInMessages([msg('cible au début')], 'cible')[0];
	assert.equal(hit.before, '');
	const tail = findInMessages([msg('tout à la fin: cible')], 'cible')[0];
	assert.equal(tail.after, '');
});

test('results come newest first and stop at the limit', () => {
	const messages = [msg('alpha un'), msg('alpha deux'), msg('alpha trois')];
	const hits = findInMessages(messages, 'alpha', 2);
	assert.deepEqual(
		hits.map((h) => h.match && h.after.trim()),
		['trois', 'deux']
	);
	assert.equal(findInMessages(messages, 'alpha').length, 3);
	assert.equal(findInMessages(messages, 'alpha', 0).length, 0);
});

test('a query shorter than the floor matches nothing', () => {
	assert.equal(MIN_QUERY_CHARS, 2);
	assert.equal(findInMessages([msg('a b c')], 'a').length, 0);
	assert.equal(findInMessages([msg('a b c')], '   ').length, 0);
	assert.equal(findInMessages([msg('a b c')], '').length, 0);
});

test('an accent stored apart from its letter stays inside the match', () => {
	// "café" written as "cafe" + U+0301: the mark folds to nothing, so without
	// care it would fall just outside the excerpt's match and render alone.
	const hit = findInMessages([msg('un cafe\u0301 serré')], 'cafe')[0];
	assert.equal(hit.match, 'cafe\u0301');
	assert.ok(!hit.after.startsWith('\u0301'));
});

test('the role and timestamp travel with the hit', () => {
	const one = msg('la question posée', 'user');
	const hits = findInMessages([one], 'question');
	assert.equal(hits[0].role, 'user');
	assert.equal(hits[0].id, one.id);
	assert.equal(hits[0].timestamp, one.timestamp);
});

test('a message still streaming is refolded, not answered from the cache', () => {
	// Same id, growing content: the fold cache is keyed by id, so a stale entry
	// would keep reporting the old text — the live turn would never match.
	const growing: SearchableMessage = { id: 'live', role: 'assistant', content: 'je réfl' };
	assert.equal(findInMessages([growing], 'réfléchis').length, 0);
	growing.content = 'je réfléchis à la question';
	assert.equal(findInMessages([growing], 'réfléchis').length, 1);
});

test('an empty message is skipped rather than matched on nothing', () => {
	assert.equal(findInMessages([msg('')], 'quoi').length, 0);
});

test('the search reaches a long transcript in one pass', () => {
	// 400 messages, the needle in the third-oldest: the loop must not stop at
	// the limit before it has walked the whole list.
	const many = Array.from({ length: 400 }, (_, i) => msg(`message ordinaire numéro ${i}`));
	many[2].content = 'la clef est sous le paillasson';
	const hits = findInMessages(many, 'paillasson');
	assert.equal(hits.length, 1);
	assert.equal(hits[0].id, many[2].id);
});
