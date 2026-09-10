import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ICONS, ICON_NAMES, icon } from '../src/lib/icons.ts';

/**
 * Emoji were the app's icon set, and they are not one: each platform draws its
 * own from its own font, in colours no palette has a say over, sized by the
 * text around them. These tests keep the drawn set honest and keep the emoji
 * from coming back.
 */

test('every icon has at least one drawn path', () => {
	for (const name of ICON_NAMES) {
		const def = icon(name);
		const paths = [...(def.stroke ?? []), ...(def.fill ?? [])];
		assert.ok(paths.length > 0, `${name} draws nothing`);
		for (const d of paths) {
			// Path data, on the 24×24 grid the component declares.
			assert.match(d, /^[Mm]/, `${name}: a path must start with a move`);
			assert.ok(d.length > 3, `${name}: suspiciously short path`);
		}
	}
});

test('icon names are the ones the components ask for', () => {
	const dirs = [
		new URL('../src/lib/components/', import.meta.url),
		new URL('../src/routes/', import.meta.url)
	];
	const used = new Set<string>();
	for (const dir of dirs) {
		for (const file of readdirSync(dir).filter((f) => f.endsWith('.svelte'))) {
			const source = readFileSync(new URL(file, dir), 'utf8');
			for (const m of source.matchAll(/<Icon[^>]*\bname="([a-zA-Z]+)"/g)) used.add(m[1]);
			// The ternary form: name={cond ? 'a' : 'b'}. Only the branches count —
			// a string on the left of `===` is what the condition tests, not an
			// icon (`toast.kind === 'error' ? 'warning' : …`).
			for (const m of source.matchAll(/<Icon[^>]*\bname=\{[^}]*\}/g)) {
				for (const q of m[0].matchAll(/[?:]\s*'([a-zA-Z]+)'/g)) used.add(q[1]);
			}
		}
	}
	assert.ok(used.size > 12, `only ${used.size} icons found — the scan is broken`);
	for (const name of used) {
		assert.ok(name in ICONS, `<Icon name="${name}"> has no path in the set`);
	}
});

/**
 * `toolIcon` returns names from this set, not glyphs — the timeline used to
 * look different on the phone than on the desktop for that reason.
 */
test('every tool family maps onto a real icon', async () => {
	const { toolIcon } = await import('../src/lib/transcript.ts');
	const families = [
		'mcp_x_y',
		'_thinking',
		'browser_navigate',
		'web_search',
		'terminal',
		'execute_code',
		'read_file',
		'memory_store',
		'generate_image',
		'todo',
		'cron_add',
		'delegate_task',
		'anything'
	];
	for (const name of families) assert.ok(toolIcon(name) in ICONS, `${name} → unknown icon`);
});

/**
 * The guard against a relapse: no component may carry a pictographic emoji.
 *
 * Agent personas keep an `emoji` column — it is user data, and it still rides
 * into the composed system prompt — but nothing in the interface draws one any
 * more, so nothing in a `.svelte` file needs one.
 */
test('no component contains an emoji any more', () => {
	const dirs = [
		new URL('../src/lib/components/', import.meta.url),
		new URL('../src/routes/', import.meta.url)
	];
	const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
	for (const dir of dirs) {
		for (const file of readdirSync(dir).filter((f) => f.endsWith('.svelte'))) {
			const source = readFileSync(new URL(file, dir), 'utf8');
			const hit = EMOJI.exec(source);
			assert.equal(hit, null, `${file} still contains ${hit?.[0]}`);
		}
	}
});
