import { MAX_CONCURRENT_TURNS } from './config';

/**
 * Local guardrails, in front of Hermes' own.
 *
 * The threat here is not abuse — one user on a private tailnet — but the Pi.
 * A stuck retry loop in a phone browser, or three tabs left open with pending
 * turns, can bury a Pi 5 in concurrent agents (each of which may spawn
 * Chromium). Failing fast with a readable message is kinder than swapping.
 */

// ---------------------------------------------------------------------------
// Concurrent agent turns
// ---------------------------------------------------------------------------

let activeTurns = 0;

export function tryAcquireTurn(): boolean {
	if (MAX_CONCURRENT_TURNS > 0 && activeTurns >= MAX_CONCURRENT_TURNS) return false;
	activeTurns++;
	return true;
}

export function releaseTurn(): void {
	activeTurns = Math.max(0, activeTurns - 1);
}

export const currentTurns = () => activeTurns;
export const turnLimit = () => MAX_CONCURRENT_TURNS;

// ---------------------------------------------------------------------------
// Request rate
// ---------------------------------------------------------------------------

interface Bucket {
	tokens: number;
	updated: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Token bucket, refilling at `perSecond` up to `burst`.
 *
 * Keyed by an arbitrary string (route class). Single-user app, so there is no
 * per-IP dimension to track and the map stays tiny.
 */
export function allowRequest(key: string, perSecond: number, burst: number): boolean {
	const now = Date.now();
	const bucket = buckets.get(key) ?? { tokens: burst, updated: now };
	bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.updated) / 1000) * perSecond);
	bucket.updated = now;
	if (bucket.tokens < 1) {
		buckets.set(key, bucket);
		return false;
	}
	bucket.tokens -= 1;
	buckets.set(key, bucket);
	return true;
}
