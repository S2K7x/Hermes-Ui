import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

/**
 * Streaming-aware markdown rendering.
 *
 * Two problems this solves:
 *  1. Mid-stream text has unbalanced constructs — an open ``` fence, a half
 *     written table, a dangling ** — which a plain parser renders as garbage
 *     that flickers as the rest arrives. `closeOpenConstructs` speculatively
 *     balances them so the partial text renders as what it is becoming.
 *  2. Parsing on every token pegs the Pi's CPU. Callers debounce (see
 *     RENDER_DEBOUNCE_MS) rather than rendering per delta.
 */

/** Re-parse cadence during streaming. 16ms (frame-rate) melts a Pi 5; at
 *  50–100ms the typewriter still reads as smooth. */
export const RENDER_DEBOUNCE_MS = 70;

marked.setOptions({ gfm: true, breaks: true });

/**
 * Balance constructs left open by a truncated stream.
 * Operates on a copy — never mutates the authoritative buffer.
 */
export function closeOpenConstructs(md: string): string {
	const lines = md.split('\n');

	// Walk the lines tracking fence state, so a *closed* block's own backticks
	// are never mistaken for an unbalanced inline span. `prose` collects only
	// the lines that markdown treats as text.
	const fenceRe = /^[ \t]*(```+|~~~+)/;
	let openMarker: string | null = null;
	const prose: string[] = [];

	for (const line of lines) {
		const fence = fenceRe.exec(line);
		if (openMarker) {
			// Inside a block: only a matching fence closes it.
			if (fence && fence[1].startsWith(openMarker)) openMarker = null;
			continue;
		}
		if (fence) {
			openMarker = fence[1];
			continue;
		}
		prose.push(line);
	}

	// A block still open at the end of the buffer: close it and stop. Its
	// contents are opaque, so no inline balancing applies.
	if (openMarker) {
		return md.endsWith('\n') ? md + openMarker : `${md}\n${openMarker}`;
	}

	let out = md;

	// Inline code span left open on the last prose line.
	const lastProse = prose.at(-1) ?? '';
	if ((lastProse.match(/`/g) || []).length % 2 === 1) out += '`';

	// Emphasis, counted over prose only and with inline code stripped — a
	// literal `**` inside backticks is not an emphasis marker.
	const text = prose.join('\n').replace(/`[^`]*`/g, '');
	if ((text.match(/\*\*/g) || []).length % 2 === 1) out += '**';
	if ((text.replace(/\*\*/g, '').match(/\*/g) || []).length % 2 === 1) out += '*';

	// A link whose closing paren has not arrived yet renders as literal
	// brackets; drop the incomplete tail instead of flashing the raw URL.
	out = out.replace(/\[[^\]\n]*\]\([^)\n]*$/, '');

	return out;
}

function highlight(html: string): string {
	// hljs is applied post-parse on the sanitised DOM in `renderMarkdown`.
	return html;
}

const purifyConfig = {
	ADD_ATTR: ['target', 'rel'],
	// Hermes returns images as data: URLs (inline vision output).
	ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i
};

/**
 * Parse + sanitise. `streaming` enables speculative construct closing.
 * Returns HTML safe to inject with {@html}.
 */
export function renderMarkdown(src: string, streaming = false): string {
	const text = streaming ? closeOpenConstructs(src) : src;
	const raw = marked.parse(text, { async: false }) as string;
	return DOMPurify.sanitize(highlight(raw), purifyConfig) as unknown as string;
}

/**
 * Syntax-highlight the code blocks inside an already-rendered container.
 * Run this only when a message is final — highlighting a block that is still
 * growing is wasted work and causes visible re-colouring.
 */
export function highlightCodeBlocks(root: HTMLElement): void {
	for (const block of root.querySelectorAll<HTMLElement>('pre code:not([data-hl])')) {
		try {
			hljs.highlightElement(block);
		} catch {
			/* unknown language — leave it plain */
		}
		block.dataset.hl = '1';
	}
}
