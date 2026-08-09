import assert from 'node:assert/strict';
import test from 'node:test';
import { newSSEState, parseSSEChunk } from '../src/lib/sse.ts';
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
