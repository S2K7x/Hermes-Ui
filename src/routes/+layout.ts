// Single-user private app: no SEO, no crawlers, no per-request SSR work on a
// Pi. Everything renders client-side against the proxy routes.
export const ssr = false;
export const prerender = false;
