/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';

/**
 * App-shell cache only.
 *
 * Nothing under /api is ever cached: session lists, transcripts and the SSE
 * stream must always hit the server, and a stale cached transcript would be
 * worse than an offline error. The worker exists so the PWA opens instantly
 * and survives a dropped tailnet, not to work offline.
 */

const CACHE = `hermes-shell-${version}`;
const SHELL = [...build, ...files];

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== location.origin) return;
	if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

	// Cache-first for immutable build assets, network-first for everything
	// else so a deploy is picked up without a hard reload.
	const isAsset = SHELL.includes(url.pathname);
	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			if (isAsset) {
				const hit = await cache.match(url.pathname);
				if (hit) return hit;
			}
			try {
				const response = await fetch(request);
				if (response.ok && response.type === 'basic') {
					cache.put(request, response.clone());
				}
				return response;
			} catch (err) {
				const hit = await cache.match(request);
				if (hit) return hit;
				throw err;
			}
		})()
	);
});
