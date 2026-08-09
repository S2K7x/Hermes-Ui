/** Shared (browser + server) incremental SSE frame parser. */

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
