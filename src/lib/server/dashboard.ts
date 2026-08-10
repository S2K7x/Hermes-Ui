import { HERMES_DASHBOARD_TOKEN, HERMES_DASHBOARD_URL, REQUEST_TIMEOUT_MS } from './config';
import { errorResponse } from './respond';
import type {
	EnvVarMap,
	OauthPollResponse,
	OauthProvider,
	OauthStartResponse,
	ValidationResult
} from '$lib/providers';

/**
 * Client for Hermes' dashboard API (`hermes_cli/web_server.py`), the second
 * server on this host — 127.0.0.1:9119, its own token, its own concerns.
 *
 * Built on the same rules as `hermes.ts`: a timeout on every call, retries
 * only on reads, and one typed error class so routes never have to read an
 * upstream body. Two things are specific to this one:
 *
 * 1. **The token never leaves the server.** It travels in
 *    `X-Hermes-Session-Token` on outbound calls and appears in no response.
 * 2. **No credential value is ever logged or echoed back.** The dashboard hands
 *    out `redacted_value`; `/api/env/reveal` exists upstream and is
 *    deliberately not proxied.
 *
 * When `HERMES_DASHBOARD_TOKEN` is unset every call raises
 * `dashboard_disabled` and the providers panel turns itself off, exactly the
 * way an unmounted `SKILLS_DIR` disables the skills editor.
 */

export class DashboardError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, message: string, code: string) {
		super(message);
		this.name = 'DashboardError';
		this.status = status;
		this.code = code;
	}
}

export const DashboardErrorCode = {
	Disabled: 'dashboard_disabled',
	Unreachable: 'dashboard_unreachable',
	Timeout: 'dashboard_timeout',
	Unauthorized: 'dashboard_unauthorized',
	Failed: 'dashboard_error'
} as const;

const DISABLED_MESSAGE =
	'La gestion des providers est désactivée : HERMES_DASHBOARD_TOKEN n\'est pas configuré.';

/** Is the feature usable at all? Drives the panel's on/off, never throws. */
export function dashboardConfigured(): boolean {
	return HERMES_DASHBOARD_TOKEN.length > 0 && HERMES_DASHBOARD_URL.length > 0;
}

interface CallOptions {
	method?: string;
	body?: unknown;
	timeoutMs?: number;
	/** Retry transient failures. Reads only — a PUT here writes a credential. */
	retries?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransient(err: unknown): boolean {
	if (!(err instanceof DashboardError)) return false;
	return (
		err.status >= 500 ||
		err.code === DashboardErrorCode.Unreachable ||
		err.code === DashboardErrorCode.Timeout
	);
}

/**
 * One call against the dashboard, decoded.
 *
 * FastAPI reports failures as `{"detail": "..."}`; those messages are about
 * names and reachability, never about the value that was sent, so they are
 * safe to pass through to the browser.
 */
async function dashboardJson<T>(path: string, opts: CallOptions = {}): Promise<T> {
	if (!dashboardConfigured()) {
		throw new DashboardError(503, DISABLED_MESSAGE, DashboardErrorCode.Disabled);
	}

	const attempts = (opts.retries ?? 0) + 1;
	let lastError: unknown;

	for (let attempt = 0; attempt < attempts; attempt++) {
		if (attempt > 0) await sleep(150 * 2 ** (attempt - 1));
		try {
			return await once<T>(path, opts);
		} catch (err) {
			lastError = err;
			if (attempt === attempts - 1 || !isTransient(err)) throw err;
		}
	}
	throw lastError;
}

async function once<T>(path: string, opts: CallOptions): Promise<T> {
	const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
	const headers: Record<string, string> = {
		Accept: 'application/json',
		'X-Hermes-Session-Token': HERMES_DASHBOARD_TOKEN
	};
	if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

	let res: Response;
	try {
		res = await fetch(`${HERMES_DASHBOARD_URL}${path}`, {
			method: opts.method || 'GET',
			headers,
			body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
			signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
		});
	} catch (err) {
		if ((err as Error)?.name === 'TimeoutError') {
			throw new DashboardError(
				504,
				`Le dashboard Hermes n'a pas répondu en ${timeoutMs} ms.`,
				DashboardErrorCode.Timeout
			);
		}
		throw new DashboardError(
			502,
			"Le dashboard Hermes est injoignable (service hermes-dashboard démarré ?).",
			DashboardErrorCode.Unreachable
		);
	}

	const text = await res.text();
	let parsed: any = null;
	if (text) {
		try {
			parsed = JSON.parse(text);
		} catch {
			/* non-JSON body — the status check below still reports it */
		}
	}

	if (!res.ok) {
		if (res.status === 401 || res.status === 403) {
			throw new DashboardError(
				res.status,
				'Le dashboard Hermes a refusé le jeton. Vérifiez HERMES_DASHBOARD_TOKEN ' +
					'contre HERMES_DASHBOARD_SESSION_TOKEN dans ~/.hermes/dashboard.env.',
				DashboardErrorCode.Unauthorized
			);
		}
		const detail = parsed?.detail;
		throw new DashboardError(
			res.status,
			(typeof detail === 'string' ? detail : detail?.[0]?.msg) ||
				text ||
				`Le dashboard Hermes a renvoyé HTTP ${res.status}.`,
			DashboardErrorCode.Failed
		);
	}
	return parsed as T;
}

/** Same shape as `proxy()` in respond.ts, for DashboardError instead of HermesError. */
export async function dashboardResponse<T>(fn: () => Promise<T>): Promise<Response> {
	try {
		const value = await fn();
		return new Response(JSON.stringify(value ?? null), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		if (err instanceof DashboardError) return errorResponse(err.status, err.message, err.code);
		const message = err instanceof Error ? err.message : String(err);
		return errorResponse(502, message, DashboardErrorCode.Unreachable);
	}
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * Every known env var with its metadata. Values come back redacted — the
 * dashboard never puts a secret in this payload, and neither do we.
 */
export const getEnvVars = () => dashboardJson<EnvVarMap>('/api/env', { retries: 1 });

/**
 * Store a credential.
 *
 * Upstream this is `save_provider_env_credential`, which writes `.env` and
 * reconciles the mirrors config.yaml keeps of the same key. Never retried: a
 * replayed write is a second rotation.
 */
export const setEnvVar = (key: string, value: string) =>
	dashboardJson<Record<string, unknown>>('/api/env', {
		method: 'PUT',
		body: { key, value }
	});

/** Remove a credential, along with the mirrors upstream knows about. */
export const deleteEnvVar = (key: string) =>
	dashboardJson<Record<string, unknown>>('/api/env', {
		method: 'DELETE',
		body: { key }
	});

/**
 * Network probe of a credential before it is stored.
 *
 * Only OPENROUTER / OPENAI / XAI / GEMINI have a probe upstream; anything else
 * answers `{ok: true, reachable: false}`, which means "unknown", not "bad".
 * Given a slow provider, 15 s beats the default.
 */
export const validateCredential = (key: string, value: string) =>
	dashboardJson<ValidationResult>('/api/providers/validate', {
		method: 'POST',
		body: { key, value },
		timeoutMs: 15_000
	});

// ---------------------------------------------------------------------------
// Accounts (OAuth)
// ---------------------------------------------------------------------------

export const listOauthProviders = () =>
	dashboardJson<{ providers: OauthProvider[] }>('/api/providers/oauth', { retries: 1 });

/**
 * Begin a login. `external` providers answer 400 with the CLI command to run
 * — that is a legitimate outcome the UI displays, not a bug to paper over.
 *
 * The device-code branch for `openai-codex` blocks upstream for up to 10 s
 * waiting for a user code, hence the roomier timeout.
 */
export const startOauth = (id: string) =>
	dashboardJson<OauthStartResponse>(
		`/api/providers/oauth/${encodeURIComponent(id)}/start`,
		{ method: 'POST', body: {}, timeoutMs: 25_000 }
	);

/**
 * Read a pending login's status.
 *
 * Retried once: a dropped poll must not end a flow the user is halfway
 * through, and the call has no side effect upstream.
 */
export const pollOauth = (id: string, sessionId: string) =>
	dashboardJson<OauthPollResponse>(
		`/api/providers/oauth/${encodeURIComponent(id)}/poll/${encodeURIComponent(sessionId)}`,
		{ retries: 1, timeoutMs: 10_000 }
	);

/** PKCE only (Anthropic): hand back the code the callback page displayed. */
export const submitOauthCode = (id: string, sessionId: string, code: string) =>
	dashboardJson<{ ok?: boolean; status?: string; message?: string }>(
		`/api/providers/oauth/${encodeURIComponent(id)}/submit`,
		{ method: 'POST', body: { session_id: sessionId, code }, timeoutMs: 30_000 }
	);

/** Abandon a pending login so its background poller stops. */
export const cancelOauthSession = (sessionId: string) =>
	dashboardJson<{ ok?: boolean }>(
		`/api/providers/oauth/sessions/${encodeURIComponent(sessionId)}`,
		{ method: 'DELETE' }
	);

/** Log a provider out. Upstream refuses (400) for CLI-owned credentials. */
export const disconnectOauth = (id: string) =>
	dashboardJson<{ ok?: boolean; provider?: string }>(
		`/api/providers/oauth/${encodeURIComponent(id)}`,
		{ method: 'DELETE' }
	);

// ---------------------------------------------------------------------------
// Cron delivery targets
// ---------------------------------------------------------------------------

/**
 * Where a scheduled job can send its output.
 *
 * The gateway has no equivalent endpoint — `deliver` is resolved at fire time
 * from `*_HOME_CHANNEL` env vars the API server never exposes — so this one
 * read comes from the dashboard. `home_target_set` is what tells apart a
 * platform that will actually deliver from one that would resolve to nothing.
 *
 * Read-only and carries no credential, which is why it is safe to surface even
 * though the rest of the dashboard proxy guards writes.
 */
export const getCronDeliveryTargets = () =>
	dashboardJson<{ targets: { id: string; name?: string; home_target_set?: boolean }[] }>(
		'/api/cron/delivery-targets',
		{ retries: 1, timeoutMs: 8000 }
	);

// ---------------------------------------------------------------------------
// Global default model
// ---------------------------------------------------------------------------

export interface ModelAssignmentResult {
	ok?: boolean;
	provider?: string;
	model?: string;
	/** Set when the model is flagged expensive and the caller must confirm. */
	confirm_required?: boolean;
	confirm_message?: string;
}

/**
 * Point `config.yaml` at another provider/model.
 *
 * This is the GLOBAL default, so it only affects conversations created after
 * it — an open one is re-pinned through `POST /api/sessions/{id}/model` on the
 * gateway (see `chat.setModel`). Without `confirm_expensive_model` the
 * dashboard may answer `confirm_required` instead of writing anything; that is
 * a normal answer to surface, not an error.
 */
export const setMainModel = (body: {
	provider: string;
	model: string;
	confirm_expensive_model?: boolean;
}) =>
	dashboardJson<ModelAssignmentResult>('/api/model/set', {
		method: 'POST',
		body: { scope: 'main', ...body },
		timeoutMs: 25_000
	});
