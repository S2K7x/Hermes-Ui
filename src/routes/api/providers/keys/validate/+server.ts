import type { RequestHandler } from './$types';
import { errorResponse, gate, readJson } from '$lib/server/respond';
import { dashboardResponse, validateCredential } from '$lib/server/dashboard';
import { MAX_KEY_LENGTH, isEnvKeyName } from '$lib/providers';

interface ValidateBody {
	key?: unknown;
	value?: unknown;
}

/**
 * Probe a credential with the provider before storing it.
 *
 * Nothing is persisted here, and the answer carries no value — only
 * `{ok, reachable, message}`. Only four providers are probeable upstream;
 * everything else answers "unknown", which the UI reports as such instead of
 * blocking the save.
 */
export const POST: RequestHandler = async ({ request }) => {
	const limited = gate('providers-validate', 0.5, 4);
	if (limited) return limited;

	const parsed = await readJson<ValidateBody>(request);
	if ('response' in parsed) return parsed.response;

	if (!isEnvKeyName(parsed.body.key)) {
		return errorResponse(400, 'Nom de variable invalide.', 'invalid_env_key');
	}
	const value = parsed.body.value;
	if (typeof value !== 'string' || value.trim() === '') {
		return errorResponse(400, 'Saisissez une valeur.', 'invalid_env_value');
	}
	if (value.length > MAX_KEY_LENGTH) {
		return errorResponse(400, 'Valeur trop longue pour une clé API.', 'invalid_env_value');
	}

	return dashboardResponse(() => validateCredential(parsed.body.key as string, value.trim()));
};
