import type { RequestHandler } from './$types';
import { gate, readJson } from '$lib/server/respond';
import {
	createSkill,
	listCategories,
	listSkillFiles,
	skillsEditingAvailable,
	skillsJson
} from '$lib/server/skills';

/**
 * The skill tree as files, not as "what Hermes has loaded" (that stays
 * `/api/skills`). `available: false` is a normal answer, not an error: the
 * bind mount is optional and the UI hides the editor rather than failing.
 */
export const GET: RequestHandler = async () => {
	const limited = gate('skills-fs-read', 4, 12);
	if (limited) return limited;

	if (!(await skillsEditingAvailable())) {
		return new Response(JSON.stringify({ available: false, entries: [], categories: [] }), {
			headers: { 'Content-Type': 'application/json' }
		});
	}
	return skillsJson(async () => ({
		available: true,
		entries: await listSkillFiles(),
		categories: await listCategories()
	}));
};

interface CreateBody {
	category?: unknown;
	name?: unknown;
	description?: unknown;
	content?: unknown;
}

export const POST: RequestHandler = async ({ request }) => {
	const limited = gate('skills-fs-write', 1, 6);
	if (limited) return limited;

	const parsed = await readJson<CreateBody>(request);
	if ('response' in parsed) return parsed.response;
	const { category, name, description, content } = parsed.body;

	return skillsJson(() =>
		createSkill({
			category: String(category ?? ''),
			name: String(name ?? ''),
			description: typeof description === 'string' ? description : undefined,
			content: typeof content === 'string' ? content : undefined
		})
	);
};
