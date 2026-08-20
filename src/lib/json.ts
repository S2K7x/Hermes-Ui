/**
 * JSON that may not be JSON.
 *
 * Every HTTP client here reads the body as text before looking at it: an
 * FastAPI error page, an empty 204 or a body cut in half must not throw before
 * the status has been read — the status is the useful half. An empty or
 * unparseable body decodes to `null`, and the caller reports the status.
 *
 * Returns `unknown` rather than `any` on purpose: each caller knows the shape
 * it expects and says so, instead of inheriting a value nothing type-checks.
 */
export function decodeJson(text: string): unknown {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
