/** Shared (browser + server) SSE framing: the byte parser, and the read loop
 *  both consumers of a turn stream run on top of it. */

import type { StreamEventData, StreamEventName } from './types';

export interface ParsedSSE {
	event: string;
	data: string;
}

export interface SSEParserState {
	buffer: string;
}

export const newSSEState = (): SSEParserState => ({ buffer: '' });

/**
 * Feed decoded text chunks in order. Returns the frames that are complete and
 * retains the trailing partial frame in `state.buffer` for the next call.
 */
export function parseSSEChunk(state: SSEParserState, chunk: string): ParsedSSE[] {
	// Normalise CRLF so a proxy that rewrites line endings can't break framing.
	state.buffer += chunk.replace(/\r\n/g, '\n');
	const out: ParsedSSE[] = [];
	let idx: number;
	while ((idx = state.buffer.indexOf('\n\n')) !== -1) {
		const raw = state.buffer.slice(0, idx);
		state.buffer = state.buffer.slice(idx + 2);
		let event = 'message';
		const dataLines: string[] = [];
		for (const line of raw.split('\n')) {
			if (!line || line.startsWith(':')) continue; // `: keepalive` comment
			if (line.startsWith('event:')) event = line.slice(6).trim();
			else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
		}
		if (dataLines.length) out.push({ event, data: dataLines.join('\n') });
	}
	return out;
}

/**
 * Hermes turn events after which the stream may legitimately end.
 *
 * `done` is the normal terminator, `error` replaces it when the run threw, and
 * both `run.completed` and `assistant.completed` mean the answer is already in
 * hand — losing the socket after either is cosmetic.
 */
const TERMINAL_TURN_EVENTS: Set<StreamEventName> = new Set([
	'done',
	'error',
	'run.completed',
	'assistant.completed'
]);

/**
 * Did this event conclude the turn?
 *
 * Used to tell a finished stream from a truncated one. An SSE body that ends
 * without any of these — the upstream write loop bailing out, a proxy closing
 * the response — reaches the reader as a plain end of stream and throws
 * nothing, so without this check a half-written answer would render exactly
 * like a complete one.
 */
export function isTerminalTurnEvent(event: string): boolean {
	return TERMINAL_TURN_EVENTS.has(event as StreamEventName);
}

/** One frame of a turn stream, with its payload already decoded. */
export interface TurnFrame {
	event: string;
	data: StreamEventData;
}

/** What one upstream chunk produced: the bytes as they arrived, and the frames
 *  they completed. */
export interface TurnChunk {
	bytes: Uint8Array;
	frames: TurnFrame[];
}

/**
 * Read a turn's SSE body to its end.
 *
 * Both consumers of a turn stream — the chat store in the browser and the
 * server's turn registry — carried their own copy of this loop, down to the
 * `JSON.parse` in a try/catch that skips a malformed frame rather than letting
 * it kill the turn. Two copies of a rule that only matters when something has
 * already gone wrong is one too many.
 *
 * Each chunk is yielded *with* its bytes rather than the frames alone because
 * the server mirrors the raw stream to the browser: forwarding has to keep the
 * order the wire had, so it cannot be moved after the parse.
 *
 * The reader is released when the loop ends, including when the caller breaks
 * out of it early — `for await` runs the generator's `finally` in every case.
 */
export async function* readTurnStream(
	body: ReadableStream<Uint8Array>
): AsyncGenerator<TurnChunk> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const state = newSSEState();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return;
			const frames: TurnFrame[] = [];
			for (const raw of parseSSEChunk(state, decoder.decode(value, { stream: true }))) {
				let data: StreamEventData;
				try {
					data = JSON.parse(raw.data) as StreamEventData;
				} catch {
					continue; // a malformed frame must not kill the turn
				}
				frames.push({ event: raw.event, data });
			}
			yield { bytes: value, frames };
		}
	} finally {
		// Not awaited: a cancel on a socket that has already died would be one
		// more promise to wait on before the caller may finish the turn.
		void reader.cancel().catch(() => {});
	}
}
