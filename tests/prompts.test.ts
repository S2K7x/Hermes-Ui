import test from 'node:test';
import assert from 'node:assert/strict';
import {
	MAX_PROMPTS,
	MAX_PROMPT_CHARS,
	MAX_TITLE_CHARS,
	addPrompt,
	matchPrompts,
	normalizePrompts,
	promptTitle,
	removePrompt,
	type SavedPrompt
} from '../src/lib/prompts.ts';

const make = (over: Partial<SavedPrompt> = {}): SavedPrompt => ({
	id: 'p1',
	title: 'Titre',
	text: 'Corps',
	created_at: 1,
	...over
});

test('promptTitle takes the first meaningful line without markdown furniture', () => {
	assert.equal(promptTitle('# Résumé du jour\nsuite'), 'Résumé du jour');
	assert.equal(promptTitle('\n\n- fais le point'), 'fais le point');
	assert.equal(promptTitle('1. étape une'), 'étape une');
	assert.equal(promptTitle('   '), 'Prompt');
});

test('promptTitle clips long lines', () => {
	const title = promptTitle('a'.repeat(200));
	assert.equal(title.length, MAX_TITLE_CHARS);
	assert.ok(title.endsWith('…'));
});

test('normalizePrompts rejects anything that is not a usable list', () => {
	assert.deepEqual(normalizePrompts(null), []);
	assert.deepEqual(normalizePrompts('nope'), []);
	assert.deepEqual(normalizePrompts([null, 42, {}, { text: '   ' }]), []);
});

test('normalizePrompts repairs missing and duplicated ids', () => {
	const out = normalizePrompts([{ text: 'un' }, { id: 'x', text: 'deux' }, { id: 'x', text: 'trois' }]);
	assert.equal(out.length, 3);
	assert.equal(new Set(out.map((p) => p.id)).size, 3);
});

test('normalizePrompts derives a title when none is stored', () => {
	const [only] = normalizePrompts([{ id: 'a', text: '## Veille technique\ndétails' }]);
	assert.equal(only.title, 'Veille technique');
});

test('normalizePrompts bounds the list, the body and the timestamp', () => {
	const many = Array.from({ length: MAX_PROMPTS + 10 }, (_, i) => ({ id: `p${i}`, text: `t${i}` }));
	assert.equal(normalizePrompts(many).length, MAX_PROMPTS);

	const [long] = normalizePrompts([{ id: 'a', text: 'x'.repeat(MAX_PROMPT_CHARS + 500) }]);
	assert.equal(long.text.length, MAX_PROMPT_CHARS);

	const [bad] = normalizePrompts([{ id: 'a', text: 'ok', created_at: Number.NaN }]);
	assert.equal(bad.created_at, 0);
});

test('addPrompt prepends and titles the new prompt', () => {
	const result = addPrompt([make()], '  Fais le point sur le Pi  ', 'new', 42);
	assert.ok(result.ok);
	assert.equal(result.list.length, 2);
	assert.deepEqual(result.list[0], {
		id: 'new',
		title: 'Fais le point sur le Pi',
		text: 'Fais le point sur le Pi',
		created_at: 42
	});
});

test('addPrompt refuses empty, duplicate and overflowing saves', () => {
	assert.deepEqual(addPrompt([], '   \n ', 'x', 1), { ok: false, reason: 'empty' });

	const existing = [make({ text: 'même texte' })];
	assert.deepEqual(addPrompt(existing, '  même texte ', 'x', 1), { ok: false, reason: 'duplicate' });

	const full = Array.from({ length: MAX_PROMPTS }, (_, i) => make({ id: `p${i}`, text: `t${i}` }));
	assert.deepEqual(addPrompt(full, 'encore un', 'x', 1), { ok: false, reason: 'full' });
});

test('removePrompt drops only the targeted id', () => {
	const list = [make({ id: 'a' }), make({ id: 'b' })];
	const dropped = removePrompt(list, 'a');
	assert.ok(dropped.ok);
	assert.deepEqual(
		dropped.list.map((p) => p.id),
		['b']
	);

	const missing = removePrompt(list, 'absent');
	assert.ok(missing.ok);
	assert.equal(missing.list.length, 2);
});

// Every write is a replace-all (`PUT /api/prompts` rewrites the whole prefs
// row), so an unread library must refuse rather than be treated as an empty
// one. Measured before this guard: a failed initial GET left the store empty,
// and one save replaced three stored prompts with one under a success toast.
test('a write refuses an unread library instead of erasing it', () => {
	assert.deepEqual(addPrompt(null, 'Nouveau prompt', 'x', 1), {
		ok: false,
		reason: 'unloaded'
	});
	assert.deepEqual(removePrompt(null, 'a'), { ok: false, reason: 'unloaded' });
});

test('an empty library is still writable — [] is not null', () => {
	const result = addPrompt([], 'Premier prompt', 'x', 1);
	assert.ok(result.ok);
	assert.equal(result.list.length, 1);
});

test('matchPrompts ignores case and accents, and searches the body too', () => {
	const list = [
		make({ id: 'a', title: 'Résumé', text: 'résume ma veille' }),
		make({ id: 'b', title: 'Docker', text: 'liste les conteneurs' })
	];
	assert.deepEqual(
		matchPrompts(list, 'resume').map((p) => p.id),
		['a']
	);
	assert.deepEqual(
		matchPrompts(list, 'CONTENEURS').map((p) => p.id),
		['b']
	);
	assert.equal(matchPrompts(list, '  ').length, 2);
});
