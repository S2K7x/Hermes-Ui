import assert from 'node:assert/strict';
import test from 'node:test';
import { isModelAvailable, providerForModel, shortModelName } from '../src/lib/models.ts';
import type { ModelOptions } from '../src/lib/types.ts';

const provider = (over: Partial<ModelOptions['providers'][number]>): ModelOptions['providers'][number] => ({
	slug: over.slug ?? 'p',
	name: over.name ?? 'Provider',
	is_current: over.is_current ?? false,
	authenticated: over.authenticated ?? true,
	models: over.models ?? [],
	total_models: over.models?.length ?? 0,
	warning: over.warning
});

const options = (providers: ModelOptions['providers']): ModelOptions => ({
	model: providers[0]?.models[0] ?? '',
	provider: providers[0]?.slug ?? '',
	providers
});

test('shortModelName keeps the last path segment', () => {
	assert.equal(shortModelName('openrouter/deepseek/free'), 'free');
	assert.equal(shortModelName('gpt-5'), 'gpt-5');
	assert.equal(shortModelName(''), '');
});

test('providerForModel finds the provider offering the model', () => {
	const opts = options([
		provider({ slug: 'openai', models: ['gpt-5'] }),
		provider({ slug: 'ollama', models: ['qwen3'] })
	]);
	assert.equal(providerForModel(opts, 'qwen3'), 'ollama');
});

test('providerForModel prefers the provider already in use on a tie', () => {
	const opts = options([
		provider({ slug: 'openrouter', models: ['qwen3'] }),
		provider({ slug: 'ollama', models: ['qwen3'], is_current: true })
	]);
	assert.equal(providerForModel(opts, 'qwen3'), 'ollama');
});

test('providerForModel ignores providers without credentials', () => {
	const opts = options([
		provider({ slug: 'anthropic', models: ['claude'], authenticated: false }),
		provider({ slug: 'openai', models: ['gpt-5'] })
	]);
	assert.equal(providerForModel(opts, 'claude'), '');
});

test('providerForModel is empty rather than wrong when nothing is known', () => {
	assert.equal(providerForModel(null, 'gpt-5'), '');
	assert.equal(providerForModel(options([provider({ models: ['gpt-5'] })]), ''), '');
	assert.equal(providerForModel(options([]), 'gpt-5'), '');
});

test('isModelAvailable tracks authenticated providers only', () => {
	const opts = options([
		provider({ slug: 'openai', models: ['gpt-5'] }),
		provider({ slug: 'anthropic', models: ['claude'], authenticated: false })
	]);
	assert.equal(isModelAvailable(opts, 'gpt-5'), true);
	assert.equal(isModelAvailable(opts, 'claude'), false);
	assert.equal(isModelAvailable(null, 'gpt-5'), false);
});
