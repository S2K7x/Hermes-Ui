import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';

/**
 * The modal shell lives in ONE place.
 *
 * Seven panels used to carry their own copy of the scrim, the centred
 * `.panel`, the title bar and the `max-width: 820px` bottom sheet — around
 * fifty identical lines each. They had already drifted apart (close targets,
 * safe-area padding, 84 vs 86 vs 88vh) before anyone noticed, which is exactly
 * what a copied block does. These tests fail if a copy comes back.
 */

const DIR = new URL('../src/lib/components/', import.meta.url);

/** Components that open as a full settings dialog, and must reuse the shell. */
const PANELS = [
	'AgentsPanel.svelte',
	'JobsPanel.svelte',
	'ProvidersPanel.svelte',
	'Shortcuts.svelte',
	'SkillsPanel.svelte',
	'StatusPanel.svelte',
	'ThemePanel.svelte'
];

const read = (name: string) => readFile(new URL(name, DIR), 'utf8');

test('every settings dialog goes through Modal', async () => {
	for (const name of PANELS) {
		const source = await read(name);
		assert.match(source, /import Modal from '\.\/Modal\.svelte'/, `${name} must import Modal`);
		assert.match(source, /<Modal\b/, `${name} must render <Modal>`);
		assert.doesNotMatch(source, /role="dialog"/, `${name} must let Modal own the dialog element`);
	}
});

test('Modal is the only component declaring the panel shell', async () => {
	const files = (await readdir(DIR)).filter((f) => f.endsWith('.svelte') && f !== 'Modal.svelte');
	for (const name of files) {
		const source = await read(name);
		// A second copy of the bottom sheet is the tell: nothing but the shell
		// repositions `.panel` at the 820px breakpoint.
		assert.doesNotMatch(
			source,
			/\.panel\s*\{[^}]*\bposition:\s*fixed/,
			`${name} re-declares the modal shell instead of using Modal.svelte`
		);
	}

	const modal = await read('Modal.svelte');
	assert.match(modal, /@media \(max-width: 820px\)/, 'Modal owns the phone bottom sheet');
	assert.match(modal, /\.panel\s*\{[^}]*\bposition:\s*fixed/, 'Modal owns the centred panel');
});
