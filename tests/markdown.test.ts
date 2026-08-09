import assert from 'node:assert/strict';
import test from 'node:test';
import { marked } from 'marked';
import { closeOpenConstructs } from '../src/lib/markdown.ts';

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
