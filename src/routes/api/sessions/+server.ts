import type { RequestHandler } from './$types';
import {
	createSession,
	getModelOptions,
	getSession,
	HermesError,
	listSessions
} from '$lib/server/hermes';
import { gate, proxy, readJson } from '$lib/server/respond';
import { cacheTitle, forgetSession, knownSessionIds, rememberSessions } from '$lib/server/db';
import { archivedCandidates } from '$lib/sessions';
import type { HermesSession } from '$lib/types';

/**
 * Titles are UNIQUE in Hermes' schema: creating a second session titled from
 * the same opening prompt ("Salut") is rejected with `invalid_title`, and the
 * insert is rolled back. Since the title here is a convenience derived from
 * the first message, a clash should not cost the user their new chat — retry
 * untitled and let them rename it.
 */
async function createSessionTolerantOfTitleClash(
	body: Parameters<typeof createSession>[0]
): ReturnType<typeof createSession> {
	try {
		return await createSession(body);
	} catch (err) {
		if (err instanceof HermesError && err.code === 'invalid_title' && body.title) {
			return createSession({ ...body, title: undefined });
		}
		throw err;
	}
}

/** Upper bound on the archive fan-out: one upstream round-trip per candidate. */
const ARCHIVE_PROBE_LIMIT = 60;
/** How many probes run at once. Small: these land on a Pi, in SQLite. */
const ARCHIVE_PROBE_CONCURRENCY = 6;

/**
 * Rebuild the list of archived conversations.
 *
 * There is no upstream listing for them — see `archivedCandidates()` — so this
 * takes every session id we have ever recorded, drops the ones the live
 * listing still returns, and asks Hermes about each survivor individually.
 * Ids that come back 404 are dropped from the index (deleted elsewhere); ids
 * that come back unarchived were merely out of the recency window.
 */
async function listArchivedSessions() {
	const live = await listSessions({ limit: 200 });
	const candidates = archivedCandidates(
		knownSessionIds(500),
		(live.data ?? []).map((s) => s.id),
		ARCHIVE_PROBE_LIMIT
	);

	const found: HermesSession[] = [];
	for (let i = 0; i < candidates.length; i += ARCHIVE_PROBE_CONCURRENCY) {
		const batch = await Promise.all(
			candidates.slice(i, i + ARCHIVE_PROBE_CONCURRENCY).map(async (id) => {
				try {
					return (await getSession(id)).session;
				} catch (err) {
					if (err instanceof HermesError && err.status === 404) forgetSession(id);
					// A transient failure must not empty the whole view.
					return null;
				}
			})
		);
		for (const session of batch) if (session?.archived) found.push(session);
	}

	return {
		object: 'list',
		data: found,
		// The client says so rather than pretending this is the whole archive.
		truncated: candidates.length >= ARCHIVE_PROBE_LIMIT
	};
}

export const GET: RequestHandler = ({ url }) => {
	if (url.searchParams.get('archived') === 'true') {
		const limited = gate('sessions:archived', 1, 5);
		if (limited) return limited;
		return proxy(listArchivedSessions);
	}

	const limited = gate('sessions:read', 8, 20);
	if (limited) return limited;
	return proxy(async () => {
		const res = await listSessions({
			limit: Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200),
			offset: Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0),
			source: url.searchParams.get('source') ?? undefined,
			include_children: url.searchParams.get('include_children') === 'true'
		});
		// Seeing a conversation here is the only chance to record its id before
		// archiving hides it from every future listing.
		rememberSessions((res.data ?? []).map((s) => s.id));
		return res;
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const limited = gate('sessions:write', 2, 8);
	if (limited) return limited;

	const parsed = await readJson<{ title?: string; model?: string; system_prompt?: string }>(request);
	if ('response' in parsed) return parsed.response;

	return proxy(async () => {
		// Resolve the gateway's configured default rather than letting Hermes
		// fall back to the virtual model name, which would poison the session
		// row (see createSession's doc comment).
		const model = parsed.body.model || (await getModelOptions()).model;
		const created = await createSessionTolerantOfTitleClash({
			title: parsed.body.title,
			model,
			system_prompt: parsed.body.system_prompt,
			source: 'api_server'
		});
		if (created.session?.id) {
			rememberSessions([created.session.id]);
			if (created.session.title) cacheTitle(created.session.id, created.session.title);
		}
		return created;
	});
};
