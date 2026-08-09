import type { RequestHandler } from './$types';
import { createSession, getModelOptions, HermesError, listSessions } from '$lib/server/hermes';
import { gate, proxy, readJson } from '$lib/server/respond';
import { cacheTitle } from '$lib/server/db';

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

export const GET: RequestHandler = ({ url }) => {
	const limited = gate('sessions:read', 8, 20);
	if (limited) return limited;
	return proxy(() =>
		listSessions({
			limit: Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200),
			offset: Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0),
			source: url.searchParams.get('source') ?? undefined,
			include_children: url.searchParams.get('include_children') === 'true'
		})
	);
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
		if (created.session?.id && created.session.title) {
			cacheTitle(created.session.id, created.session.title);
		}
		return created;
	});
};
