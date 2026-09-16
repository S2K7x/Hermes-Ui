import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { cachedRead } from '../src/lib/server/cache.ts';

/**
 * The model catalogue is the slowest thing the boot fan-out asks for — 134 ms
 * warm and 2.7 s the first time after Hermes' hourly disk cache expires,
 * measured against the running proxy on this Pi. `cachedRead` is what stops
 * the Pi paying for it again on every app open; these tests pin the policy it
 * implements, clock included, because a cache that is wrong about staleness
 * fails silently.
 */

/** A loader that counts calls and resolves on demand. */
function counter(value: () => string) {
	let calls = 0;
	return {
		calls: () => calls,
		load: async () => {
			calls += 1;
			return value();
		}
	};
}

test('a cold read waits for the upstream answer and keeps it', async () => {
	let now = 1000;
	const source = counter(() => 'v1');
	const cache = cachedRead(source.load, { freshMs: 500, now: () => now });

	assert.equal(await cache.get(), 'v1');
	assert.equal(source.calls(), 1);
});

test('inside the fresh window nothing goes upstream at all', async () => {
	let now = 1000;
	let value = 'v1';
	const source = counter(() => value);
	const cache = cachedRead(source.load, { freshMs: 500, now: () => now });

	await cache.get();
	value = 'v2';
	now = 1499;

	assert.equal(await cache.get(), 'v1');
	assert.equal(source.calls(), 1, 'a fresh entry must not trigger a fetch');
});

test('past it, the stale answer is handed back at once and refreshed behind', async () => {
	let now = 1000;
	let value = 'v1';
	const source = counter(() => value);
	const cache = cachedRead(source.load, { freshMs: 500, now: () => now });

	await cache.get();
	value = 'v2';
	now = 1600;

	// The caller is not made to wait for the refresh…
	assert.equal(await cache.get(), 'v1');
	assert.equal(source.calls(), 2, 'a stale read starts exactly one refresh');

	// …but the next one sees the new value.
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(await cache.get(), 'v2');
	assert.equal(source.calls(), 2, 'the refreshed entry is fresh again');
});

test('concurrent cold reads collapse into one upstream call', async () => {
	let now = 1000;
	let release: (v: string) => void = () => {};
	let calls = 0;
	const load = () => {
		calls += 1;
		return new Promise<string>((resolve) => (release = resolve));
	};
	const cache = cachedRead(load, { freshMs: 500, now: () => now });

	const a = cache.get();
	const b = cache.get();
	release('v1');

	assert.deepEqual(await Promise.all([a, b]), ['v1', 'v1']);
	assert.equal(calls, 1, 'boot and a new conversation asking at once is one fetch');
});

test('a failed refresh keeps the answer we already had', async () => {
	let now = 1000;
	let fail = false;
	const load = async () => {
		if (fail) throw new Error('gateway down');
		return 'v1';
	};
	const cache = cachedRead(load, { freshMs: 500, now: () => now });

	await cache.get();
	fail = true;
	now = 1600;

	assert.equal(await cache.get(), 'v1');
	// Let the background rejection settle; it must not empty the entry.
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(await cache.get(), 'v1', 'a blink upstream must not empty the picker');
});

test('a failed cold read is reported, not swallowed', async () => {
	const cache = cachedRead(
		async () => {
			throw new Error('gateway down');
		},
		{ freshMs: 500 }
	);
	await assert.rejects(() => cache.get(), /gateway down/);
});

test('invalidate() makes the next read wait for a fresh answer', async () => {
	let now = 1000;
	let value = 'v1';
	const source = counter(() => value);
	const cache = cachedRead(source.load, { freshMs: 500, now: () => now });

	await cache.get();
	value = 'v2';
	cache.invalidate();

	assert.equal(await cache.get(), 'v2');
	assert.equal(source.calls(), 2);
});

test('a refresh started before invalidate() does not reinstate the old answer', async () => {
	let now = 1000;
	const resolvers: Array<(v: string) => void> = [];
	let calls = 0;
	const load = () => {
		calls += 1;
		return new Promise<string>((resolve) => resolvers.push(resolve));
	};
	const cache = cachedRead(load, { freshMs: 500, now: () => now });

	const first = cache.get();
	cache.invalidate();
	const second = cache.get();
	assert.equal(calls, 2, 'the in-flight read no longer counts once invalidated');

	// The pre-invalidation fetch lands last, carrying the stale answer.
	resolvers[1]('new');
	resolvers[0]('old');
	assert.equal(await second, 'new');
	assert.equal(await first, 'old');

	// The entry must be the post-invalidation one, with no upstream call.
	now = 1100;
	assert.equal(await cache.get(), 'new');
	assert.equal(calls, 2);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test('the model catalogue is read through the cache, never straight from the gateway', async () => {
	for (const file of ['src/routes/api/models/+server.ts', 'src/routes/api/sessions/+server.ts']) {
		const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
		assert.ok(
			!/getModelOptions/.test(source),
			`${file} must go through $lib/server/catalog, not hermes.getModelOptions`
		);
		assert.match(source, /modelOptions/, `${file} should read the cached catalogue`);
	}
});

test('a dashboard write drops the cached catalogue', async () => {
	const source = await readFile(new URL('../src/lib/server/dashboard.ts', import.meta.url), 'utf8');
	// A credential stored, an account connected, the global model moved: all of
	// them change what the gateway can route, and all of them are non-GET.
	assert.match(source, /invalidateModelOptions/);
	assert.match(source, /opts\.method \?\? 'GET'\) !== 'GET'/);
});
