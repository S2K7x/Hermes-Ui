import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ out: 'build' }),
		// SvelteKit's own origin check is baked in at build time, so it cannot
		// know the Tailscale Serve hostname of the machine the image runs on.
		// It is disabled here and re-implemented at runtime in
		// src/hooks.server.ts, which reads HERMES_PUBLIC_ORIGIN from the
		// environment. Do NOT drop the hook along with this line — without
		// either, any web page could drive the agent from a tailnet device.
		csrf: { trustedOrigins: ['*'] }
	}
};
