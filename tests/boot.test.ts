import assert from 'node:assert/strict';
import test from 'node:test';
import { methodBody, source } from './source.ts';

/**
 * What the app is allowed to wait for before showing a conversation.
 *
 * Opening the app fans out to several endpoints, and one of them is not like
 * the others: `GET /api/model/options` rebuilds Hermes' provider inventory
 * behind a one-hour disk cache and refetches the provider catalogues over the
 * internet once it has expired. **Measured against the running app on this
 * Pi**: capabilities 5 ms, session list 6–60 ms, transcript 6 ms — models
 * 134 ms warm and 1.9 s on the first call after expiry.
 *
 * Awaited in `init()`, that number *was* the time to first message: the
 * transcript request could not even start until a list of models nobody had
 * asked to see had come back. These tests fail if the wait comes back.
 */

const STORE = 'src/lib/stores/chat.svelte.ts';

test('boot does not wait for the model catalogue', () => {
	const body = methodBody(source(STORE), 'async init()');
	assert.ok(body.includes('this.refreshCatalog()'), 'init() must still start the catalogue');
	assert.doesNotMatch(
		body,
		/await[^;\n]*refreshCatalog/,
		'init() must not await the catalogue: it delays the transcript by up to 1.9 s'
	);
	assert.doesNotMatch(
		body,
		/Promise\.(all|allSettled)\([^)]*refreshCatalog/s,
		'the catalogue must not join the awaited boot fan-out'
	);
});

test('the model and skills listings are fetched side by side', () => {
	const body = methodBody(source(STORE), 'async refreshCatalog()');
	assert.match(
		body,
		/Promise\.all\(/,
		'chaining the two adds the slower listing’s latency to the faster one’s'
	);
});

test('creating a conversation still waits for the catalogue', () => {
	const body = methodBody(source(STORE), 'async send(');
	const wait = body.indexOf('catalogReady()');
	const create = body.indexOf('this.newSession(');
	assert.notEqual(wait, -1, 'send() must settle the debt before pinning a model');
	assert.notEqual(create, -1, 'send() must still be able to open a conversation');
	// Hermes pins the model id on the session row for good, and one it cannot
	// route makes every later turn fail with a 400 (CLAUDE.md §1). The
	// catalogue is what vets `nextModel`, so it has to land first.
	assert.ok(wait < create, 'the catalogue must be awaited before newSession()');
});
