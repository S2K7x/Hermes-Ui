import assert from 'node:assert/strict';
import test from 'node:test';
import { marked } from 'marked';
import { readFile } from 'node:fs/promises';
import {
	closeOpenConstructs,
	highlightCodeBlocks,
	highlighterReady,
	loadHighlighter,
	MAX_RENDER_DEBOUNCE_MS,
	RENDER_DEBOUNCE_MS,
	renderDelayMs,
	stablePrefixEnd
} from '../src/lib/markdown.ts';

// `renderMarkdown` itself needs a DOM for DOMPurify, so these tests cover the
// two halves that carry the logic: the speculative balancing of a truncated
// stream, and that the balanced text parses into the elements we style.
marked.setOptions({ gfm: true, breaks: true });
const html = (md: string) => marked.parse(md, { async: false }) as string;

test('closes an open code fence', () => {
	const out = closeOpenConstructs('Voici :\n```bash\nvcgencmd measure_temp');
	assert.match(out, /```\s*$/);
	assert.match(html(out), /<pre><code class="language-bash">/);
});

test('leaves a balanced fence alone', () => {
	const src = '```js\nconst a = 1;\n```';
	assert.equal(closeOpenConstructs(src), src);
});

test('does not balance emphasis inside an open fence', () => {
	// A lone ** inside code is literal; appending a closer would corrupt it.
	const out = closeOpenConstructs('```\na ** b');
	assert.equal(out, '```\na ** b\n```');
});

test('closes a dangling inline code span', () => {
	assert.equal(closeOpenConstructs('utilise `vcgencmd'), 'utilise `vcgencmd`');
});

test('closes dangling bold and italic', () => {
	assert.equal(closeOpenConstructs('c est **import'), 'c est **import**');
	assert.equal(closeOpenConstructs('c est *import'), 'c est *import*');
});

test('drops a half-written link instead of showing the raw URL', () => {
	assert.equal(closeOpenConstructs('voir [la doc](https://exa'), 'voir ');
});

test('renders the elements the stylesheet targets', () => {
	const out = html(
		['## Titre', '', '| Metric | Value |', '| --- | --- |', '| Temp | 59.3°C |'].join('\n')
	);
	assert.match(out, /<h2>Titre<\/h2>/);
	assert.match(out, /<table>/);
	assert.match(out, /<th>Metric<\/th>/);
	assert.match(out, /<td>59\.3°C<\/td>/);
});

// ---------------------------------------------------------------------------
// Lazy grammar bundle
// ---------------------------------------------------------------------------

// `highlight.js/lib/common` is 164 KB of grammar definitions that used to sit
// in the eager entry chunk (42% of its raw weight). These tests pin the two
// properties that keep it out of the critical path: importing this module must
// not pull it in, and nothing may assume it is resident.

test('the grammar bundle is imported dynamically, never statically', async () => {
	const source = await readFile(new URL('../src/lib/markdown.ts', import.meta.url), 'utf8');
	// A static `import ... from 'highlight.js...'` would put all 37 grammars
	// back into the entry chunk, silently undoing the measured saving.
	assert.doesNotMatch(source, /^\s*import\s[^\n]*from\s+['"]highlight\.js/m);
	assert.match(source, /import\(\s*['"]highlight\.js\/lib\/common['"]\s*\)/);
});

test('highlighting is inert until the grammar bundle is loaded', () => {
	assert.equal(highlighterReady(), false);
	// Must not throw, and must not mark the block as highlighted — the caller
	// re-runs it after the load, so a premature data-hl would leave it plain.
	const block = { dataset: {} as Record<string, string> };
	const root = { querySelectorAll: () => [block], querySelector: () => block };
	highlightCodeBlocks(root as unknown as HTMLElement);
	assert.equal(block.dataset.hl, undefined);
});

test('loadHighlighter is idempotent and flips highlighterReady', async () => {
	const first = loadHighlighter();
	assert.equal(loadHighlighter(), first, 'a second call must reuse the in-flight import');
	assert.ok(await first);
	assert.equal(highlighterReady(), true);
});

// ---------------------------------------------------------------------------
// Re-render cadence
// ---------------------------------------------------------------------------

// A streaming re-render re-parses, re-sanitises and replaces the whole message
// subtree, so it costs about a millisecond per kilobyte on the Pi (measured:
// 2.8 ms at 1.9 kB, 20.3 ms at 20 kB, 33.2 ms at 34 kB). At a flat 70 ms that
// is 4% of a core for a short answer and 47% for a long one. The delay grows
// with the message so the rate of work stays flat instead.

test('short answers keep the original typewriter cadence', () => {
	assert.equal(renderDelayMs(0), RENDER_DEBOUNCE_MS);
	assert.equal(renderDelayMs(400), RENDER_DEBOUNCE_MS);
	// The floor holds right up to where the scaled value overtakes it.
	assert.equal(renderDelayMs(6999), RENDER_DEBOUNCE_MS);
	assert.equal(renderDelayMs(7000), RENDER_DEBOUNCE_MS);
});

test('the delay grows with the message, then stops', () => {
	assert.equal(renderDelayMs(10_000), 100);
	assert.equal(renderDelayMs(20_000), 200);
	assert.equal(renderDelayMs(30_000), MAX_RENDER_DEBOUNCE_MS);
	// Past the cap the typewriter must keep moving, whatever it costs.
	assert.equal(renderDelayMs(500_000), MAX_RENDER_DEBOUNCE_MS);
});

test('the delay never leaves the bounds, whatever it is handed', () => {
	for (const chars of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 1e9]) {
		const delay = renderDelayMs(chars);
		assert.ok(
			delay >= RENDER_DEBOUNCE_MS && delay <= MAX_RENDER_DEBOUNCE_MS,
			`renderDelayMs(${chars}) = ${delay} is out of bounds`
		);
	}
});

test('the work rate stays near flat instead of growing with the answer', () => {
	// Measured cost of one render + DOM swap on this Pi, in ms.
	const measured: Array<[chars: number, ms: number]> = [
		[1877, 2.75],
		[5106, 5.74],
		[10_214, 10.55],
		[20_438, 20.27],
		[34_420, 33.21]
	];
	const share = (chars: number, ms: number, delay: number) => (ms / delay) * 100;
	const flat = measured.map(([chars, ms]) => share(chars, ms, RENDER_DEBOUNCE_MS));
	const adaptive = measured.map(([chars, ms]) => share(chars, ms, renderDelayMs(chars)));
	// The flat cadence ends up spending nearly half a core on redraw alone.
	assert.ok(Math.max(...flat) > 45, `flat peak was ${Math.max(...flat)}%`);
	// The adaptive one never gets close, and never costs *more* than before.
	assert.ok(Math.max(...adaptive) < 15, `adaptive peak was ${Math.max(...adaptive)}%`);
	for (let i = 0; i < measured.length; i++) {
		assert.ok(adaptive[i] <= flat[i] + 1e-9, `${measured[i][0]} chars got slower`);
	}
});

// ---------------------------------------------------------------------------
// stablePrefixEnd — the part of a streaming answer that will not be re-parsed
// ---------------------------------------------------------------------------

/**
 * Replay a whole turn the way `Markdown.svelte` does, and check at every step
 * that the two pieces render into what one whole-buffer parse renders.
 *
 * This is the only property the optimisation rests on. The boundary itself is
 * an implementation detail; being able to cut there is not.
 */
function replaySplit(doc: string, steps = Number.POSITIVE_INFINITY) {
	let from = 0;
	let head = '';
	let disabled = false;
	const norm = (h: string) => h.replace(/\s+/g, ' ').trim();
	const stride = Math.max(1, Math.floor(doc.length / steps));
	let frozeSomething = false;
	let everDisabled = false;
	for (let n = 1; n <= doc.length; n += stride) {
		const src = doc.slice(0, n);
		if (!disabled) {
			const cut = stablePrefixEnd(src, from);
			if (cut < 0) {
				disabled = true;
				everDisabled = true;
				from = 0;
				head = '';
			} else if (cut > from) {
				assert.ok(cut <= src.length, 'boundary past the end of the buffer');
				head += html(src.slice(from, cut));
				from = cut;
				frozeSomething = true;
			}
		}
		if (disabled) continue;
		assert.equal(
			norm(head + html(src.slice(from))),
			norm(html(src)),
			`split at ${from} of ${src.length} rendered differently`
		);
	}
	return { frozeSomething, everDisabled, from };
}

test('a frozen prefix plus the live tail render as one whole parse', () => {
	const docs = [
		'Intro.\n\n## Un\n\ntexte **gras**\n\n## Deux\n\n- a\n- b\n\n## Trois\n\nfin',
		'Voici :\n\n```bash\nls -la\n```\n\nEt puis :\n\n```ts\nconst a = 1;\n```\n\nVoilà.',
		// A loose list must not be cut between its items and turned into two.
		'Avant.\n\n- a\n\n- b\n\n## Après\n\nsuite',
		// An indent-0 fence ends a list upstream too, so cutting there is a no-op.
		'- item un\n- item deux\n\n```\ncode\n```\n\n- item trois',
		'| a | b |\n| --- | --- |\n| 1 | 2 |\n\n## Suite\n\ntexte',
		'> une citation\n> sur deux lignes\n\n## Titre\n\naprès',
		'para un\n\n---\n\npara deux\n\n***\n\npara trois',
		// Headings inside a fence are text, not boundaries.
		'```md\n## pas un titre\n\n## non plus\n```\n\n## vrai titre\n\nok',
		'~~~py\nx = 1\n~~~\n\n## Titre\n\nfin',
		// An indented fence belongs to the list item; it is not a top-level block.
		'- item\n\n    ```\n    code\n    ```\n\n## Titre\n\nfin',
		// `---` under a paragraph is a setext heading, not a break: no blank line.
		'Titre\n=====\n\nDu texte.\n\n## Autre\n\nfin',
		'1. un\n2. deux\n\n## Titre\n\n3. trois'
	];
	for (const doc of docs) {
		const { frozeSomething, everDisabled } = replaySplit(doc);
		assert.ok(!everDisabled, `splitting was abandoned on: ${doc.slice(0, 30)}`);
		assert.ok(frozeSomething, `nothing was ever frozen in: ${doc.slice(0, 30)}`);
	}
});

test('a long answer freezes almost all of itself', () => {
	let doc = "Voici l'analyse demandée.\n\n";
	for (let i = 1; i <= 10; i++) {
		doc += `## Section ${i}\n\nUn paragraphe d'explication avec de l'\`inline code\` et du **gras**.\n\n`;
		doc += '- premier point\n- deuxième point\n\n';
		doc += '```ts\nexport const f' + i + ' = (x: number) => x * ' + i + ';\n```\n\n';
	}
	const { from } = replaySplit(doc, 60);
	// The tail left live is the section being written, not the whole answer.
	assert.ok(from > doc.length * 0.8, `only froze ${from} of ${doc.length}`);
});

test('a link reference definition abandons splitting for the message', () => {
	// Declared anywhere, used anywhere: text already on screen would change.
	assert.equal(stablePrefixEnd('## Un\n\ntexte\n\n[doc]: https://exemple.fr\n'), -1);
	assert.equal(stablePrefixEnd('voir [doc]\n\n   [doc]: https://exemple.fr\n'), -1);
	// Four spaces is indented code, not a definition.
	assert.ok(stablePrefixEnd('## Un\n\n    [doc]: https://exemple.fr\n') >= 0);
});

test('a raw HTML block abandons splitting for the message', () => {
	// Its open tag can be closed blocks later; the halves would be sanitised
	// apart and the tag balanced twice.
	assert.equal(stablePrefixEnd('## Un\n\n<div class="x">\n\ndedans\n\n</div>\n'), -1);
	assert.equal(stablePrefixEnd('para\n\n<br>\n\npara\n'), -1);
	// Inline HTML in the middle of a line is not a block and is left alone.
	assert.ok(stablePrefixEnd('## Un\n\ndu texte <b>gras</b> ici\n\n## Deux\n') > 0);
});

test('nothing is frozen without a hard block start after a blank line', () => {
	assert.equal(stablePrefixEnd(''), 0);
	assert.equal(stablePrefixEnd('juste un paragraphe'), 0);
	assert.equal(stablePrefixEnd('para un\n\npara deux\n\npara trois'), 0);
	// The very first line of a message has nothing above it to freeze.
	assert.equal(stablePrefixEnd('## Titre\n\ntexte'), 0);
	// The last boundary wins — freeze as much as the text allows — and the scan
	// resumes where it left off rather than going back over frozen text.
	const doc = 'a\n\n## Un\n\nb\n\n## Deux\n\nc';
	const last = stablePrefixEnd(doc, 0);
	assert.equal(doc.slice(last, last + 7), '## Deux');
	assert.equal(stablePrefixEnd(doc, last), last);
	// Growing the buffer one section at a time walks the boundary forward.
	const upToB = doc.slice(0, doc.indexOf('## Deux'));
	const first = stablePrefixEnd(upToB, 0);
	assert.equal(upToB.slice(first, first + 5), '## Un');
});
