import { env } from '$env/dynamic/private';

function required(name: string, value: string | undefined): string {
	if (!value) {
		throw new Error(
			`${name} is not set. Copy .env.example to .env and fill it in ` +
				`(HERMES_API_KEY must match API_SERVER_KEY in ~/.hermes/.env).`
		);
	}
	return value;
}

/** Base URL of the Hermes API server. Loopback by default — never expose 8642. */
export const HERMES_API_URL = (env.HERMES_API_URL || 'http://127.0.0.1:8642').replace(/\/+$/, '');

/**
 * Bearer token for the Hermes API server. This is a root-equivalent secret:
 * the API server executes the full Hermes toolset (terminal included) on this
 * host. It stays server-side and is never serialised into a page payload.
 */
export const HERMES_API_KEY = required('HERMES_API_KEY', env.HERMES_API_KEY);

/**
 * Stable long-term-memory scope. Hermes keys Honcho/FTS5 memory off this
 * header, so it must NOT rotate with session_id — otherwise memory fragments
 * across every "new chat".
 */
export const HERMES_SESSION_KEY = env.HERMES_SESSION_KEY || 'agent:main:webui:dm:user';

/** Where the web app's own SQLite file lives (prefs/cache — not chat history). */
export const WEB_DB_PATH = env.WEB_DB_PATH || './data/hermes-web.db';

/** Session source tag written on sessions this UI creates. */
export const SESSION_SOURCE = 'api_server';

/**
 * Directory holding Hermes' skill tree (`<category>/<skill>/SKILL.md`).
 *
 * Optional on purpose. In Docker it is the `/skills` bind mount declared in
 * docker-compose.yml; in `npm run dev` outside the container it is whatever
 * the developer points it at, usually nothing. Unset — or set to something
 * unreadable — simply turns the skills editor off in the UI, which is the
 * right default for a path that sits outside this app's own data directory.
 */
export const SKILLS_DIR = env.SKILLS_DIR?.trim() || '';

/**
 * Timeout for ordinary (non-streaming) Hermes calls. Generous, because
 * `/health/detailed` walks the disk and `/api/model/options` can hit a cold
 * model cache — but finite, so a wedged upstream cannot pin sockets forever.
 * Agent streams opt out entirely (timeoutMs: 0).
 */
export const REQUEST_TIMEOUT_MS = Number(env.HERMES_TIMEOUT_MS || 30_000);

/**
 * Cap on concurrent agent turns started through this UI.
 *
 * Hermes has its own cap (`gateway.api_server.max_concurrent_runs`, default
 * 10) and answers 429 past it, but a Pi 5 starts thrashing well before ten
 * agents are each running a browser. Refusing early, with a clear message,
 * beats letting the box swap.
 */
export const MAX_CONCURRENT_TURNS = Number(env.MAX_CONCURRENT_TURNS || 3);
