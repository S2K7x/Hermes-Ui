/** Pure helpers over the `/api/model/options` inventory. */

import type { ModelOptions } from './types';

/** Last path segment — "openrouter/deepseek/free" reads as "free" in a pill. */
export function shortModelName(model: string): string {
	return model.split('/').at(-1) || model;
}

/**
 * Which provider serves `model`, as a slug Hermes accepts in a model lock.
 *
 * Hermes routes a lock request by (provider, model); sending the provider
 * removes the ambiguity when the same model id is offered by two providers
 * (a local Ollama copy and a hosted one, say). Providers without credentials
 * are skipped: locking onto one guarantees a failed turn.
 *
 * Returns '' when the model is unknown or only offered by unauthenticated
 * providers — the caller then sends the model alone and lets Hermes route it.
 */
export function providerForModel(options: ModelOptions | null, model: string): string {
	if (!options || !model) return '';
	const usable = options.providers.filter((p) => p.authenticated && p.models.includes(model));
	if (usable.length === 0) return '';
	// The provider already in use wins, so switching model inside a provider
	// does not silently migrate the conversation to another one.
	return (usable.find((p) => p.is_current) ?? usable[0]).slug;
}

/**
 * Is `model` still offered by an authenticated provider?
 *
 * A model saved in localStorage can outlive the credentials that served it.
 */
export function isModelAvailable(options: ModelOptions | null, model: string): boolean {
	if (!options || !model) return false;
	return options.providers.some((p) => p.authenticated && p.models.includes(model));
}
