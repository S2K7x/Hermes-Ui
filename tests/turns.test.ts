import test from 'node:test';
import assert from 'node:assert/strict';
import {
	PRESENCE_TTL_S,
	TURN_TEXT_CAP,
	applyTurnFrame,
	newTurnSummary,
	shouldNotifyTurn
} from '../src/lib/turns.ts';

test('deltas accumulate and assistant.completed overrides them', () => {
	const summary = newTurnSummary();
	applyTurnFrame(summary, 'assistant.delta', { delta: 'Bon' });
	applyTurnFrame(summary, 'assistant.delta', { delta: 'jour' });
	assert.equal(summary.text, 'Bonjour');
	assert.equal(summary.completed, false);

	applyTurnFrame(summary, 'assistant.completed', { content: 'Bonjour, voici l’image.' });
	assert.equal(summary.text, 'Bonjour, voici l’image.');
	assert.equal(summary.completed, true);
});

test('an empty assistant.completed does not erase the deltas', () => {
	const summary = newTurnSummary();
	applyTurnFrame(summary, 'assistant.delta', { delta: 'texte' });
	applyTurnFrame(summary, 'assistant.completed', { content: '' });
	assert.equal(summary.text, 'texte');
	assert.equal(summary.completed, true);
});

test('run.completed alone marks the turn done', () => {
	const summary = newTurnSummary();
	applyTurnFrame(summary, 'run.completed', { usage: {} });
	assert.equal(summary.completed, true);
});

test('error frames are captured', () => {
	const summary = newTurnSummary();
	applyTurnFrame(summary, 'error', { message: 'Modèle indisponible' });
	assert.equal(summary.error, 'Modèle indisponible');
	assert.equal(summary.completed, false);
});

test('unrelated frames are ignored', () => {
	const summary = newTurnSummary();
	applyTurnFrame(summary, 'tool.started', { tool_name: 'terminal' });
	applyTurnFrame(summary, 'tool.progress', { delta: 'reflexion' });
	assert.deepEqual(summary, newTurnSummary());
});

test('accumulated text is capped', () => {
	const summary = newTurnSummary();
	for (let i = 0; i < 200; i++) applyTurnFrame(summary, 'assistant.delta', { delta: 'x'.repeat(50) });
	assert.equal(summary.text.length, TURN_TEXT_CAP);
});

test('a detached client always notifies', () => {
	assert.equal(shouldNotifyTurn({ attached: false, presence: null, now: 100 }), true);
	// Even if some other window says it is visible: the reader for this turn
	// is gone, which is the iOS case the feature exists for.
	assert.equal(
		shouldNotifyTurn({ attached: false, presence: { visible: true, at: 100 }, now: 100 }),
		true
	);
});

test('an attached client with no presence report stays silent', () => {
	assert.equal(shouldNotifyTurn({ attached: true, presence: null, now: 100 }), false);
});

test('an attached but hidden tab notifies', () => {
	assert.equal(
		shouldNotifyTurn({ attached: true, presence: { visible: false, at: 100 }, now: 130 }),
		true
	);
});

test('an attached and visible tab stays silent', () => {
	assert.equal(
		shouldNotifyTurn({ attached: true, presence: { visible: true, at: 100 }, now: 130 }),
		false
	);
});

test('stale presence is ignored in favour of the attachment', () => {
	const at = 100;
	const now = at + PRESENCE_TTL_S + 1;
	assert.equal(shouldNotifyTurn({ attached: true, presence: { visible: false, at }, now }), false);
	assert.equal(shouldNotifyTurn({ attached: false, presence: { visible: true, at }, now }), true);
});

// ---------------------------------------------------------------------------
// The effective session id — what a mid-turn compression rotates it to
// ---------------------------------------------------------------------------

test('a turn that was not compressed reports no rotation', () => {
	const summary = newTurnSummary();
	assert.equal(summary.sessionId, null);
	applyTurnFrame(summary, 'run.started', { session_id: 'sess-a' });
	applyTurnFrame(summary, 'assistant.delta', { delta: 'bonjour', session_id: 'sess-a' });
	applyTurnFrame(summary, 'assistant.completed', { content: 'bonjour', session_id: 'sess-a' });
	applyTurnFrame(summary, 'run.completed', { session_id: 'sess-a' });
	assert.equal(summary.sessionId, 'sess-a');
});

test('only the terminal frames carry the effective session id', () => {
	// Every frame gets the REQUESTED id filled in by default upstream; a
	// rotation only ever shows up on assistant.completed / run.completed.
	const summary = newTurnSummary();
	applyTurnFrame(summary, 'run.started', { session_id: 'sess-a' });
	applyTurnFrame(summary, 'tool.started', { session_id: 'sess-a', tool_name: 'terminal' });
	assert.equal(summary.sessionId, null);
	applyTurnFrame(summary, 'assistant.completed', { content: 'ok', session_id: 'sess-b' });
	assert.equal(summary.sessionId, 'sess-b');
});

test('run.completed alone is enough to report the rotation', () => {
	const summary = newTurnSummary();
	applyTurnFrame(summary, 'run.completed', { session_id: 'sess-b' });
	assert.equal(summary.sessionId, 'sess-b');
	assert.equal(summary.completed, true);
});

test('a terminal frame without a session id leaves the last known one alone', () => {
	const summary = newTurnSummary();
	applyTurnFrame(summary, 'assistant.completed', { content: 'ok', session_id: 'sess-b' });
	applyTurnFrame(summary, 'run.completed', {});
	applyTurnFrame(summary, 'run.completed', { session_id: '' });
	// Cast on purpose: `StreamEventData` describes what upstream *says* it
	// sends, and nothing validates that on arrival — which is what the runtime
	// guard in `applyTurnFrame` is for.
	applyTurnFrame(summary, 'run.completed', { session_id: 42 as unknown as string });
	assert.equal(summary.sessionId, 'sess-b');
});
