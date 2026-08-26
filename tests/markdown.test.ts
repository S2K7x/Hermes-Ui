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
	renderDelayMs
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
