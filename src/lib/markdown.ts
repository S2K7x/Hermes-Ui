import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Streaming-aware markdown rendering.
 *
 * Two problems this solves:
 *  1. Mid-stream text has unbalanced constructs — an open ``` fence, a half
 *     written table, a dangling ** — which a plain parser renders as garbage
 *     that flickers as the rest arrives. `closeOpenConstructs` speculatively
 *     balances them so the partial text renders as what it is becoming.
 *  2. Parsing on every token pegs the Pi's CPU. Callers debounce rather than
 *     rendering per delta, on an interval that grows with the message — see
 *     `renderDelayMs`, where the measurements are.
 */

/** Fastest re-parse cadence during streaming. 16ms (frame-rate) melts a Pi 5;
 *  at 50–100ms the typewriter still reads as smooth. */
export const RENDER_DEBOUNCE_MS = 70;

/** Slowest cadence, reached by answers long enough for the flat one to hurt. */
export const MAX_RENDER_DEBOUNCE_MS = 300;

/**
 * How long to wait before re-parsing a message of `chars` characters.
 *
 * A re-render is not a fixed cost: it re-parses the whole buffer, re-sanitises
 * the whole output and hands `{@html}` a subtree that replaces the previous
 * one entirely. All three are linear in the length of the answer so far, and
 * the answer only grows. **Measured on this Pi 5**, in headless Chromium, one
 * full render + DOM swap of an assistant message:
 *
 * | message | parse+sanitise | DOM swap | total | share of a core at 70ms |
 * |---|---|---|---|---|
 * | 1.9 kB | 1.4ms | 1.3ms | 2.8ms | 4% |
 * | 5 kB | 2.7ms | 3.0ms | 5.7ms | 8% |
 * | 10 kB | 4.8ms | 5.7ms | 10.6ms | 15% |
 * | 20 kB | 8.8ms | 11.5ms | 20.3ms | 29% |
 * | 34 kB | 14.5ms | 18.7ms | 33.2ms | 47% |
 *
 * Roughly 1ms per kilobyte, more than half of it spent rebuilding DOM that did
 * not change — and spent on the same CPU that is running the agent writing the
 * answer. A flat cadence therefore makes the redraw cost of a long turn grow
 * without bound while the useful output per redraw stays the same handful of
 * tokens.
 *
 * So the delay grows with the message instead, keeping the *rate* of work
 * near a tenth of a core whatever the length: ~1ms of work per 100 characters
 * means one render per 100 characters' worth of milliseconds. Short answers —
 * the overwhelming majority — sit at the floor and are untouched; a 20 kB one
 * redraws every 204ms instead of every 70ms, three times less work for text
 * arriving far faster than anyone reads it.
 *
 * Replayed over a whole turn in the same browser (text at 120 chars/s), the
 * CPU spent displaying an answer while it is written: 3.7 kB 1.10s → 1.02s,
 * 10 kB 6.4s → 5.8s, 20 kB 23.9s → 13.7s, 34 kB 64.8s → 24.4s. Short answers
 * sit at the floor and do not move; a long one hands 40 seconds of a core back
 * to the Pi that is running the agent.
 *
 * The cap is not a budget, it is a floor on responsiveness: past ~30 kB the
 * typewriter must keep moving even if it costs more than the target.
 */
export function renderDelayMs(chars: number): number {
	if (!Number.isFinite(chars) || chars <= 0) return RENDER_DEBOUNCE_MS;
	const scaled = Math.round(chars / 100);
	if (scaled < RENDER_DEBOUNCE_MS) return RENDER_DEBOUNCE_MS;
	return Math.min(scaled, MAX_RENDER_DEBOUNCE_MS);
}

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
	return DOMPurify.sanitize(raw, purifyConfig) as unknown as string;
}

// ---------------------------------------------------------------------------
// Syntax highlighting — loaded on demand
// ---------------------------------------------------------------------------

/**
 * `highlight.js/lib/common` is 164 KB of grammar definitions (measured: it was
 * 42% of the raw entry chunk, 38 KB of its 103 KB brotli). Every one of its 37
 * languages builds its regex objects at module init, so importing it eagerly
 * cost that download, parse and allocation on every page load — including the
 * majority that never show a code block. It is behind a dynamic import instead.
 *
 * `hasCodeBlocks` guards the trigger, and the grammar bundle is part of the
 * service worker's precached shell, so the fetch is a cache hit after the first
 * visit rather than a round trip.
 */
type Highlighter = { highlightElement(element: HTMLElement): void };

let highlighter: Highlighter | null = null;
let pending: Promise<Highlighter | null> | null = null;

/**
 * Start loading the grammar bundle. Idempotent, and safe to call speculatively
 * — `Markdown.svelte` calls it as soon as a fence appears mid-stream so the
 * grammars are resident by the time the turn ends and highlighting can run
 * synchronously, with no uncoloured flash.
 */
export function loadHighlighter(): Promise<Highlighter | null> {
	pending ??= import('highlight.js/lib/common')
		.then((module) => (highlighter = module.default))
		.catch(() => null); // offline on a cold cache: plain code beats a crash
	return pending;
}

/** Is the grammar bundle resident, i.e. can highlighting run without waiting? */
export function highlighterReady(): boolean {
	return highlighter !== null;
}

/** Does this container hold a code block that has not been highlighted yet? */
export function hasCodeBlocks(root: HTMLElement): boolean {
	return root.querySelector('pre code:not([data-hl])') !== null;
}

/**
 * Syntax-highlight the code blocks inside an already-rendered container.
 * Run this only when a message is final — highlighting a block that is still
 * growing is wasted work and causes visible re-colouring.
 *
 * No-op while the grammar bundle is still loading; the caller re-runs it once
 * `loadHighlighter()` resolves.
 */
export function highlightCodeBlocks(root: HTMLElement): void {
	if (!highlighter) return;
	for (const block of root.querySelectorAll<HTMLElement>('pre code:not([data-hl])')) {
		try {
			highlighter.highlightElement(block);
		} catch {
			/* unknown language — leave it plain */
		}
		block.dataset.hl = '1';
	}
}
