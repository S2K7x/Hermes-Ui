import { getModelOptions, getSkills, getToolsets } from './hermes';
import { cachedRead } from './cache';
import type { HermesSkill, HermesToolset } from '$lib/types';

/**
 * The provider/model inventory, kept in memory between requests.
 *
 * It is read on two paths, and it was the slowest call on both:
 *
 * - the boot fan-out, where `chat.init()` starts it without awaiting it
 *   (CLAUDE.md §26) — so it never blocked the transcript, but it did spend
 *   134 ms of the Pi's time, or 2.7 s once an hour, on a list nobody asked to
 *   see;
 * - `POST /api/sessions`, which resolves the gateway's default model before
 *   creating a conversation. That one *is* on the critical path: it runs
 *   between pressing Enter on the first message and the turn starting.
 *
 * Five minutes of freshness, then stale-while-revalidate. Anything this app
 * does that could change the answer — a provider key written, an account
 * logged in or out, the global default model moved — goes through the
 * dashboard client, which drops this cache on the way out (see
 * `invalidateModelOptions` in `dashboard.ts`). What is left is a change made
 * from the CLI or by hand, which lands within the window.
 */
export const MODEL_OPTIONS_FRESH_MS = 5 * 60_000;

const catalogue = cachedRead(getModelOptions, { freshMs: MODEL_OPTIONS_FRESH_MS });

export const modelOptions = () => catalogue.get();

/** Forget the inventory: the next reader waits for a fresh one. */
export const invalidateModelOptions = () => catalogue.invalidate();

// ---------------------------------------------------------------------------
// What the gateway can do: its skills, and its resolved toolsets
// ---------------------------------------------------------------------------

/** The two lists `/api/skills` serves, fetched side by side. */
export interface SkillCatalogue {
	skills: HermesSkill[];
	toolsets: HermesToolset[];
}

/**
 * The second-slowest read of the boot fan-out, and the only one left uncached.
 *
 * **Measured through the running proxy on this Pi**, ten samples each:
 * `/api/skills` **25–28 ms (median 26)**, against 7 ms for a 200-row session
 * listing, 5 ms for `/api/capabilities` and 1.4 ms for the model catalogue now
 * that it is cached. It is the outlier because it is two upstream handlers, not
 * one: `_handle_skills` walks the skill tree through `_find_all_skills`, and
 * `_handle_toolsets` reloads `config.yaml`, resolves every toolset and looks up
 * the Nous entitlement state (`get_nous_subscription_features`) — all of it
 * redone from scratch on every single call.
 *
 * And nothing in that answer can have changed between two openings of the app.
 * Hermes does not reload its skills hot (CLAUDE.md §11): editing a SKILL.md
 * changes what `GET /v1/skills` reports only after
 * `systemctl --user restart hermes-gateway`. So the honest lifetime of this
 * answer is "until the gateway restarts", and five minutes of freshness — the
 * same window as the model catalogue — is well inside it.
 *
 * What the browser does with it is a skills palette, a tool counter and a line
 * on the welcome card: things you reach for, never something a turn depends on.
 * A stale-while-revalidate answer is exactly right for them.
 */
export const SKILL_CATALOGUE_FRESH_MS = 5 * 60_000;

const skills = cachedRead<SkillCatalogue>(
	async () => {
		// Two unrelated endpoints; chaining them would only add the slower
		// one's latency to the faster one's.
		const [skillList, toolsetList] = await Promise.all([getSkills(), getToolsets()]);
		return { skills: skillList.data ?? [], toolsets: toolsetList.data ?? [] };
	},
	{ freshMs: SKILL_CATALOGUE_FRESH_MS }
);

export const skillCatalogue = () => skills.get();

/**
 * Forget it: the next reader waits for a fresh listing.
 *
 * Called when the skills editor writes to the tree. Hermes will not report the
 * change until it is restarted, so this cannot make the new file appear — but
 * it means the listing is re-read the next time someone asks instead of being
 * held back by our own window on top of the gateway's. Over-invalidating costs
 * one round trip; under-invalidating would leave the panel disagreeing with the
 * disk for no reason anyone could see.
 */
export const invalidateSkillCatalogue = () => skills.invalidate();
