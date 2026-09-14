import test from 'node:test';
import assert from 'node:assert/strict';
import { panelState, shouldLoadPanel } from '../src/lib/availability.ts';
import { readFileSync } from 'node:fs';

const READY = { ready: true, disabled: false, error: null };
const DISABLED = { ready: false, disabled: true, error: null };
const NOTHING = { ready: false, disabled: false, error: null };

test('nothing read yet is neither ready nor off', () => {
	assert.equal(panelState(NOTHING), 'unread');
});

test('a successful read is reported as the server described it', () => {
	assert.equal(panelState(READY), 'ready');
	assert.equal(panelState(DISABLED), 'disabled');
});

test('a failed read is its own state, never "off"', () => {
	assert.equal(panelState({ ...NOTHING, error: 'Connexion perdue.' }), 'failed');
});

/**
 * The point of the whole module: the three real failures measured against this
 * app — the rate gate, a filesystem error, a dropped connection — must not
 * reach the screen that tells the user to edit docker-compose.yml.
 */
test('a failure outranks an "off" learned earlier', () => {
	for (const error of [
		'Trop de requêtes. Ralentissez un instant.',
		"EACCES: permission denied, scandir '/skills'",
		'Connexion perdue.'
	]) {
		assert.equal(panelState({ ...DISABLED, error }), 'failed');
		assert.equal(panelState({ ...READY, error }), 'failed');
	}
});

test('an empty message is not a failure', () => {
	// A server that answers `message: ''` alongside `available: true` must not
	// be read as broken.
	assert.equal(panelState({ ...READY, error: '' }), 'ready');
});

test('a panel re-reads when it has nothing, or when the last read failed', () => {
	assert.equal(shouldLoadPanel('unread', false), true);
	assert.equal(shouldLoadPanel('failed', false), true);
});

test('a settled panel does not re-read on every opening', () => {
	assert.equal(shouldLoadPanel('ready', false), false);
	assert.equal(shouldLoadPanel('disabled', false), false);
});

test('opening twice while a read is in flight queues only one', () => {
	for (const state of ['unread', 'failed', 'ready', 'disabled'] as const) {
		assert.equal(shouldLoadPanel(state, true), false);
	}
});

/**
 * Source check, in the spirit of `tests/panels.test.ts`: the three gated panels
 * must decide through this module. Reintroducing `available === null` as the
 * load guard would silently bring back the sticky misdiagnosis, and nothing
 * else in the suite would notice.
 *
 * The `untrack` half matters just as much and is not cosmetic. `failed` is a
 * state that asks to be reloaded, so an effect that re-ran whenever the store
 * changed would call `refresh()`, see the failure land, and call it again —
 * hammering, in a loop, the exact endpoint that just failed. Reading the store
 * untracked leaves `open` as the effect's only dependency, which is what makes
 * "once per opening" true.
 */
test('the gated panels load through shouldLoadPanel, once per opening', () => {
	for (const file of ['SkillsPanel', 'ProvidersPanel', 'JobsPanel']) {
		const source = readFileSync(`src/lib/components/${file}.svelte`, 'utf8');
		assert.match(source, /shouldLoadPanel\(/, `${file} must gate its read on shouldLoadPanel()`);
		assert.match(
			source,
			/untrack\(\(\) => shouldLoadPanel\(/,
			`${file} must read the state untracked, or a failed read retries in a loop`
		);
	}
});
