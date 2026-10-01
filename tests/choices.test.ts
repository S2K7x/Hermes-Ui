import assert from 'node:assert/strict';
import test from 'node:test';
import { methodBody, source } from './source.ts';

/**
 * The three choices a conversation carries, and the one algorithm behind them.
 *
 * A model, an agent and a reasoning effort are picked the same way: the value
 * becomes the default for new conversations, the open session's row is patched
 * optimistically, a POST goes out, and a refusal has to put **both** halves
 * back. They used to be three copies of that, two of which opened with "same
 * shape as `setModel()`" — a comment is not an abstraction.
 *
 * The half a copy forgets is the stored preference. Hermes refuses a model it
 * cannot route (409 `model_lock_unavailable`) instead of falling back, so a
 * rejected choice left in `localStorage` would be pinned on the next
 * conversation and fail every turn of it (CLAUDE.md §1). These tests check that
 * the rollback still exists, and still exists only once.
 */

const STORE = 'src/lib/stores/chat.svelte.ts';
const SETTERS = ['async setModel(', 'async setAgent(', 'async setReasoning('];

test('all three choices go through the one helper', () => {
	const src = source(STORE);
	for (const setter of SETTERS) {
		const body = methodBody(src, setter);
		assert.match(body, /this\.#choose</, `${setter} must delegate to #choose`);
		// The tell-tale of a re-grown copy: its own request, or its own catch.
		assert.doesNotMatch(body, /\bapi</, `${setter} must not POST on its own`);
		assert.doesNotMatch(body, /\bcatch\b/, `${setter} must not own the rollback`);
	}
});

test('a refused choice puts back the row and the stored preference', () => {
	const body = methodBody(source(STORE), 'async #choose<');
	const failure = body.slice(body.indexOf('catch'));
	assert.notEqual(failure, '', '#choose must still handle a refusal');
	assert.match(failure, /#patchLocal\(id, choice\.rollback\)/, 'the session row must go back');
	assert.match(
		failure,
		/choice\.remember\(choice\.was\)/,
		'the preference must go back too, or the refused choice returns on the next discussion'
	);
	assert.match(failure, /toasts\.error\(/, 'and the user has to be told');
});

test('the preference is stored before the open conversation is considered', () => {
	const body = methodBody(source(STORE), 'async #choose<');
	const remember = body.indexOf('choice.remember(choice.value)');
	const bail = body.indexOf('if (!id) return');
	assert.notEqual(remember, -1, '#choose must store the preference');
	assert.notEqual(bail, -1, '#choose must tolerate having no conversation open');
	// A gateway without `session_model_lock` passes `target: null`: there is
	// nothing to re-pin, and the choice must still reach the next discussion.
	assert.ok(remember < bail, 'remembering must not depend on a conversation being open');
});

test('only the model asks the gateway whether it may re-pin', () => {
	const src = source(STORE);
	assert.match(
		methodBody(src, 'async setModel('),
		/canSwitchModel \? this\.sessionId : null/,
		'without POST /api/sessions/{id}/model the choice is for the next discussion only'
	);
	for (const setter of ['async setAgent(', 'async setReasoning(']) {
		assert.doesNotMatch(
			methodBody(src, setter),
			/canSwitchModel/,
			`${setter} is stored by this app, not by Hermes: the capability is irrelevant`
		);
	}
});
