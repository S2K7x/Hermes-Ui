import assert from 'node:assert/strict';
import test from 'node:test';
import { marked } from 'marked';
import { readFile } from 'node:fs/promises';
import {
	closeOpenConstructs,
	highlightCodeBlocks,
	highlighterReady,
	loadHighlighter
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
