import assert from 'node:assert/strict';
import test from 'node:test';
import {
	isTerminalTurnEvent,
	newSSEState,
	parseSSEChunk,
	readTurnStream
} from '../src/lib/sse.ts';
import { groupTranscript } from '../src/lib/transcript.ts';

test('reassembles a frame split across chunks', () => {
	const state = newSSEState();
	assert.deepEqual(parseSSEChunk(state, 'event: assistant.delta\ndata: {"del'), []);
	const frames = parseSSEChunk(state, 'ta":"bon"}\n\n');
	assert.deepEqual(frames, [{ event: 'assistant.delta', data: '{"delta":"bon"}' }]);
});

test('ignores keepalive comments', () => {
	const state = newSSEState();
	const frames = parseSSEChunk(state, ': keepalive\n\nevent: done\ndata: {}\n\n');
	assert.deepEqual(frames, [{ event: 'done', data: '{}' }]);
});

test('handles several frames in one chunk and CRLF framing', () => {
	const state = newSSEState();
	const frames = parseSSEChunk(
		state,
		'event: a\r\ndata: 1\r\n\r\nevent: b\r\ndata: 2\r\n\r\n'
	);
	assert.deepEqual(frames, [
		{ event: 'a', data: '1' },
		{ event: 'b', data: '2' }
	]);
});

/** Replay a whole SSE body the way the chat store consumes it. */
function replay(body: string): { text: string; terminated: boolean } {
	const state = newSSEState();
	let text = '';
	let terminated = false;
	// One byte-ish chunk at a time, to exercise the incremental path too.
	for (let i = 0; i < body.length; i += 7) {
		for (const frame of parseSSEChunk(state, body.slice(i, i + 7))) {
			if (frame.event === 'assistant.delta') text += JSON.parse(frame.data).delta ?? '';
			if (isTerminalTurnEvent(frame.event)) terminated = true;
		}
	}
	return { text, terminated };
}

test('recognises every event that can legitimately end a turn', () => {
	for (const event of ['done', 'error', 'run.completed', 'assistant.completed']) {
		assert.equal(isTerminalTurnEvent(event), true, event);
	}
	const midTurn = [
		'run.started',
		'message.started',
		'assistant.delta',
		'tool.started',
		'tool.completed',
		'tool.progress',
		'message'
	];
	for (const event of midTurn) assert.equal(isTerminalTurnEvent(event), false, event);
});

test('a complete turn reports itself as terminated', () => {
	const { text, terminated } = replay(
		'event: run.started\ndata: {}\n\n' +
			'event: assistant.delta\ndata: {"delta":"Il est "}\n\n' +
			'event: assistant.delta\ndata: {"delta":"17:00."}\n\n' +
			'event: assistant.completed\ndata: {"content":"Il est 17:00."}\n\n' +
			'event: run.completed\ndata: {}\n\n' +
			'event: done\ndata: {}\n\n'
	);
	assert.equal(text, 'Il est 17:00.');
	assert.equal(terminated, true);
});

test('a stream cut mid-turn is not mistaken for a finished one', () => {
	// No `done`, no `run.completed`: the reader simply runs out of bytes, which
	// throws nothing. Only the missing terminal event reveals the truncation.
	const { text, terminated } = replay(
		'event: run.started\ndata: {}\n\n' +
			'event: assistant.delta\ndata: {"delta":"Je commence l\'analyse"}\n\n'
	);
	assert.equal(text, "Je commence l'analyse");
	assert.equal(terminated, false);
});

test('a turn that failed upstream counts as terminated, not truncated', () => {
	// The error frame already raises a toast; it must not raise a second,
	// contradictory "stream truncated" warning on top of it.
	const { terminated } = replay('event: error\ndata: {"message":"boom","status":500}\n\n');
	assert.equal(terminated, true);
});

test('folds a persisted transcript into user / assistant turns', () => {
	const turns = groupTranscript([
		{ role: 'user', content: 'quelle heure ?', id: 1 },
		{ role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'terminal' } }], id: 2 },
		{ role: 'tool', content: '{"output":"17:00"}', tool_call_id: 'c1', tool_name: 'terminal', id: 3 },
		{ role: 'assistant', content: 'Il est 17:00.', id: 4 }
	]);

	assert.equal(turns.length, 2);
	assert.equal(turns[0].role, 'user');
	assert.equal(turns[1].role, 'assistant');
	assert.equal(turns[1].content, 'Il est 17:00.');
	// The tool_calls row and the tool result row describe one step, not two.
	assert.equal(turns[1].steps.length, 1);
	assert.equal(turns[1].steps[0].tool_name, 'terminal');
	assert.equal(turns[1].steps[0].status, 'done');
});

test('extracts text and images from multimodal user content', () => {
	const turns = groupTranscript([
		{
			role: 'user',
			content: [
				{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
				{ type: 'text', text: 'décris ça' }
			] as any,
			id: 1
		}
	]);
	assert.equal(turns[0].content, 'décris ça');
	assert.deepEqual(turns[0].images, ['data:image/png;base64,AAA']);
});

// ---------------------------------------------------------------------------
// readTurnStream — the loop the chat store and the server's turn registry share
// ---------------------------------------------------------------------------

/** An SSE body delivered in `size`-byte chunks, like a real socket would. */
function bodyOf(text: string, size = 7): ReadableStream<Uint8Array> {
	const bytes = new TextEncoder().encode(text);
	let offset = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (offset >= bytes.length) {
				controller.close();
				return;
			}
			controller.enqueue(bytes.slice(offset, offset + size));
			offset += size;
		}
	});
}

test('readTurnStream decodes frames split across chunk boundaries', async () => {
	const frames = [];
	for await (const chunk of readTurnStream(
		bodyOf(
			'event: assistant.delta\ndata: {"delta":"Il est "}\n\n' +
				'event: assistant.delta\ndata: {"delta":"17:00."}\n\n' +
				'event: done\ndata: {}\n\n'
		)
	)) {
		frames.push(...chunk.frames);
	}
	assert.deepEqual(
		frames.map((f) => f.event),
		['assistant.delta', 'assistant.delta', 'done']
	);
	assert.equal(frames[0].data.delta, 'Il est ');
	assert.equal(frames[1].data.delta, '17:00.');
});

test('readTurnStream yields the raw bytes alongside the frames they completed', async () => {
	// The server mirrors these bytes to the browser, so they must come out in
	// wire order and lose nothing — including the chunks that complete no frame.
	const body = 'event: run.started\ndata: {}\n\nevent: done\ndata: {}\n\n';
	const decoder = new TextDecoder();
	let mirrored = '';
	for await (const chunk of readTurnStream(bodyOf(body, 5))) mirrored += decoder.decode(chunk.bytes);
	assert.equal(mirrored, body);
});

test('a malformed frame is skipped, not fatal', async () => {
	const events = [];
	for await (const chunk of readTurnStream(
		bodyOf(
			'event: assistant.delta\ndata: {not json\n\n' +
				'event: assistant.delta\ndata: {"delta":"suite"}\n\n'
		)
	)) {
		for (const frame of chunk.frames) events.push(frame);
	}
	assert.equal(events.length, 1);
	assert.equal(events[0].data.delta, 'suite');
});

test('leaving the loop early releases the reader', async () => {
	// The chat store returns as soon as it sees `done`; the upstream reader has
	// to be let go then, not only when the body runs dry.
	let cancelled = false;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('event: done\ndata: {}\n\n'));
		},
		cancel() {
			cancelled = true;
		}
	});

	for await (const chunk of readTurnStream(stream)) {
		if (chunk.frames.some((f) => f.event === 'done')) break;
	}
	// `reader.cancel()` is fired without being awaited, so let the microtask run.
	await Promise.resolve();
	assert.equal(cancelled, true);
});
