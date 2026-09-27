import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
	DEFAULT_REASONING,
	REASONING_EFFORTS,
	modelDoesReasoning,
	normalizeReasoning,
	reasoningHint,
	reasoningLabel,
	reasoningModelOptions
} from '../src/lib/reasoning.ts';
import type { ModelOptions } from '../src/lib/types.ts';

const provider = (over: Partial<ModelOptions['providers'][number]>): ModelOptions['providers'][number] => ({
	slug: over.slug ?? 'p',
	name: over.name ?? 'Provider',
	is_current: over.is_current ?? false,
	authenticated: over.authenticated ?? true,
	models: over.models ?? [],
	total_models: over.models?.length ?? 0,
	capabilities: over.capabilities,
	pricing: over.pricing
});

const options = (providers: ModelOptions['providers']): ModelOptions => ({
	model: providers[0]?.models?.[0] ?? '',
	provider: providers[0]?.slug ?? '',
	providers
});

// ---------------------------------------------------------------------------
// The set of efforts must stay the one upstream accepts
// ---------------------------------------------------------------------------

test('the offered efforts are auto plus exactly what api_server accepts', () => {
	// `_REASONING_EFFORTS` in gateway/platforms/api_server.py (0.20.0). Anything
	// outside that set is silently ignored upstream, which would leave the chip
	// looking selected while the turn ran on the gateway's own default.
	assert.deepEqual([...REASONING_EFFORTS], [
		'auto',
		'none',
		'minimal',
		'low',
		'medium',
		'high',
		'xhigh'
	]);
	assert.equal(DEFAULT_REASONING, 'auto');
});

test('every effort has a label and a hint', () => {
	for (const effort of REASONING_EFFORTS) {
		assert.ok(reasoningLabel(effort).length > 0, effort);
		assert.ok(reasoningHint(effort).length > 0, effort);
	}
	// Distinct labels: two chips reading the same word are two chips nobody can
	// choose between.
	const labels = REASONING_EFFORTS.map(reasoningLabel);
	assert.equal(new Set(labels).size, labels.length);
});

// ---------------------------------------------------------------------------
// normalizeReasoning
// ---------------------------------------------------------------------------

test('normalizeReasoning keeps a known effort and folds case and space', () => {
	assert.equal(normalizeReasoning('high'), 'high');
	assert.equal(normalizeReasoning(' XHIGH '), 'xhigh');
});

test('normalizeReasoning reads anything else as auto', () => {
	for (const bad of [null, undefined, '', 'ultra', 'max', 42, {}, [], true]) {
		assert.equal(normalizeReasoning(bad), 'auto', String(bad));
	}
});

// ---------------------------------------------------------------------------
// What goes on the wire
// ---------------------------------------------------------------------------

test('auto sends no model_options at all', () => {
	assert.equal(reasoningModelOptions('auto'), undefined);
});

test('none disables thinking with the boolean every provider plugin reads', () => {
	assert.deepEqual(reasoningModelOptions('none'), { reasoning: { enabled: false } });
});

test('a level sends enabled plus that level', () => {
	assert.deepEqual(reasoningModelOptions('low'), { reasoning: { enabled: true, effort: 'low' } });
	assert.deepEqual(reasoningModelOptions('xhigh'), {
		reasoning: { enabled: true, effort: 'xhigh' }
	});
});

test('no effort but auto ever produces an empty payload', () => {
	for (const effort of REASONING_EFFORTS) {
		if (effort === 'auto') continue;
		const payload = reasoningModelOptions(effort);
		assert.ok(payload, effort);
		assert.equal(typeof payload.reasoning.enabled, 'boolean', effort);
	}
});

// ---------------------------------------------------------------------------
// modelDoesReasoning
// ---------------------------------------------------------------------------

test('a model the catalogue calls non-reasoning loses the dial', () => {
	const opts = options([
		provider({ slug: 'p', models: ['dumb'], capabilities: { dumb: { reasoning: false } } })
	]);
	assert.equal(modelDoesReasoning(opts, 'dumb'), false);
});

test('a reasoning model keeps it, and an unlisted one is assumed capable', () => {
	const opts = options([
		provider({ slug: 'p', models: ['smart'], capabilities: { smart: { reasoning: true } } })
	]);
	assert.equal(modelDoesReasoning(opts, 'smart'), true);
	// Same default as upstream's `_apply_capabilities`: hiding the dial from a
	// capable-but-uncatalogued model is the worse failure.
	assert.equal(modelDoesReasoning(opts, 'unknown'), true);
	assert.equal(modelDoesReasoning(null, 'smart'), true);
	assert.equal(modelDoesReasoning(opts, ''), true);
});

test('a provider row without a capabilities map does not veto another that has one', () => {
	const opts = options([
		provider({ slug: 'bare', models: ['m'] }),
		provider({ slug: 'rich', models: ['m'], capabilities: { m: { reasoning: false } } })
	]);
	assert.equal(modelDoesReasoning(opts, 'm'), false);
});

// ---------------------------------------------------------------------------
// The two halves the browser must not own
// ---------------------------------------------------------------------------

test('the stream route composes model_options itself', () => {
	// Same contract as `system_message` (CLAUDE.md §18): upstream keeps
	// `model_options` request-scoped, so the effort has to be re-sent on every
	// turn — and from the server, or two tabs could disagree about it.
	const route = readFileSync('src/routes/api/sessions/[id]/stream/+server.ts', 'utf8');
	assert.match(route, /model_options:\s*reasoningForTurn\(params\.id\)/);
	// The browser's body is read for `message` only; nothing else of it is
	// forwarded.
	assert.doesNotMatch(route, /body\.model_options/);
});

test('the turn body never carries a model alongside the options', () => {
	// `model` in that body would be a per-turn model override resolved by
	// `_session_runtime_request_from_body`, not a reasoning setting.
	const route = readFileSync('src/routes/api/sessions/[id]/stream/+server.ts', 'utf8');
	assert.doesNotMatch(route, /\bmodel:\s/);
});
