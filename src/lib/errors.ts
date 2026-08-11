/** Error vocabulary shared by the proxy and the browser. */

export interface ApiErrorBody {
	error: {
		message: string;
		/** Hermes' own code when it supplied one, else one of ours below. */
		code?: string;
		/** Seconds the client should wait before retrying (429 / 503). */
		retry_after?: number;
	};
}

/**
 * Codes this app mints itself, on top of whatever Hermes returns.
 *
 * A const object rather than an `enum`: `node --test` runs the sources through
 * type stripping, which cannot compile enums (they emit runtime code).
 */
export const AppErrorCode = {
	Unreachable: 'hermes_unreachable',
	Timeout: 'hermes_timeout',
	RateLimited: 'rate_limit_exceeded',
	TooLarge: 'payload_too_large',
	Forbidden: 'forbidden_origin',
	SessionGone: 'session_not_found',
	Unknown: 'unknown_error'
} as const;

export type AppErrorCode = (typeof AppErrorCode)[keyof typeof AppErrorCode];

/**
 * Client-side error carrying the HTTP status and code for UI decisions.
 *
 * Fields are assigned explicitly rather than declared as constructor
 * parameter properties — type stripping (used by `node --test`) cannot compile
 * those either.
 */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly retryAfter?: number;

	constructor(status: number, message: string, code?: string, retryAfter?: number) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code || AppErrorCode.Unknown;
		this.retryAfter = retryAfter;
	}

	/** Would trying again, unchanged, plausibly succeed? */
	get retryable(): boolean {
		if (this.status === 429) return true;
		if (this.status >= 500) return true;
		return this.code === AppErrorCode.Unreachable || this.code === AppErrorCode.Timeout;
	}
}

/**
 * Turn any thrown value into a sentence a person can act on.
 *
 * Raw upstream text is kept as a fallback but the known failure modes get a
 * specific explanation — "Too many concurrent runs (max 10)" tells the user
 * nothing about what to do, "un autre tour est déjà en cours" does.
 */
export function humanizeError(err: unknown): string {
	if (!(err instanceof ApiError)) {
		const message = err instanceof Error ? err.message : String(err);
		return message || 'Une erreur inattendue est survenue.';
	}

	switch (err.code) {
		case AppErrorCode.Unreachable:
			return "Hermes ne répond pas. Le gateway est-il démarré ? (systemctl --user status hermes-gateway)";
		case AppErrorCode.Timeout:
			return 'Hermes a mis trop de temps à répondre.';
		case AppErrorCode.RateLimited:
			return "Hermes exécute déjà le maximum de tours simultanés. Réessayez dans un instant.";
		case AppErrorCode.TooLarge:
			return 'Message trop volumineux. Réduisez la taille ou le nombre des images.';
		case AppErrorCode.SessionGone:
			return "Cette conversation n'existe plus (supprimée ailleurs ?).";
		case 'session_exists':
			return 'Une conversation porte déjà cet identifiant.';
		case 'invalid_title':
			return err.message; // upstream explains which title collides
		case 'session_db_unavailable':
			return "La base de données de Hermes est indisponible (state.db).";
		case 'model_lock_persistence_failed':
			return "Le modèle demandé n'a pas pu être enregistré sur la conversation.";
		case 'model_lock_unavailable':
			// Upstream refuses rather than falling back to the global default.
			return "Hermes ne sait pas router ce modèle. Vérifiez que le fournisseur est configuré (`hermes model`).";
		case 'missing_model':
			return 'Aucun modèle sélectionné.';
		case 'push_unavailable':
			return "Les notifications ne sont pas configurées sur le serveur (clés VAPID absentes).";
		case 'device_not_found':
			return "Cet appareil n'est plus abonné aux notifications.";
	}

	if (err.status === 401 || err.status === 403) {
		return "Authentification refusée par Hermes. HERMES_API_KEY correspond-elle à API_SERVER_KEY ?";
	}
	return err.message || `Erreur HTTP ${err.status}.`;
}
