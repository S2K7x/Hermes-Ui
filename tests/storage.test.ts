import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { legacyKey } from '../src/lib/client/storage.ts';

/**
 * Renaming the app renamed its localStorage keys. A draft, the last open
 * conversation and the pre-paint theme cache all live there, so the first
 * launch under the new name must carry them across rather than start empty —
 * a rename that silently drops a half-written message is not a rename anyone
 * asked for.
 */

test('legacyKey maps a namespaced key back to the name it had before', () => {
	assert.equal(legacyKey('yadai-drafts'), 'hermes-drafts');
	assert.equal(legacyKey('yadai-theme-cache'), 'hermes-theme-cache');
	assert.equal(legacyKey('yadai-last-session'), 'hermes-last-session');
});

test('legacyKey claims nothing that is not ours', () => {
	// A key from another origin's library, or one already carrying the old
	// name, must not be rewritten into something else again.
	assert.equal(legacyKey('hermes-drafts'), null);
	assert.equal(legacyKey('theme'), null);
	assert.equal(legacyKey(''), null);
	assert.equal(legacyKey('sveltekit:scroll'), null);
});

/**
 * The prefix only migrates what actually asks for it. A key written under the
 * bare old name would never be read again — this is the guard that no caller
 * keeps one.
 */
test('every localStorage key the app reads carries the current prefix', () => {
	const root = new URL('../src/', import.meta.url);
	const files: URL[] = [];
	const walk = (dir: URL) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
			if (entry.isDirectory()) walk(child);
			else if (/\.(ts|svelte|html)$/.test(entry.name)) files.push(child);
		}
	};
	walk(root);

	for (const file of files) {
		const source = readFileSync(file, 'utf8');
		for (const match of source.matchAll(/'(hermes-[a-z-]+)'/g)) {
			// storage.ts owns the mapping and app.html reads the old cache once
			// before hydration; both are the migration itself, not a caller.
			assert.ok(
				/storage\.ts$|app\.html$/.test(file.pathname),
				`${file.pathname} still reads ${match[1]}`
			);
		}
	}
});
