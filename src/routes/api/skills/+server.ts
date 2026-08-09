import type { RequestHandler } from './$types';
import { getSkills, getToolsets } from '$lib/server/hermes';
import { proxy } from '$lib/server/respond';

export const GET: RequestHandler = () =>
	proxy(async () => {
		const [skills, toolsets] = await Promise.all([getSkills(), getToolsets()]);
		return { skills: skills.data ?? [], toolsets: toolsets.data ?? [] };
	});
