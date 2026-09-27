import db from './db';
import {
	DEFAULT_REASONING,
	normalizeReasoning,
	reasoningModelOptions,
	type ReasoningEffort,
	type ReasoningModelOptions
} from '$lib/reasoning';

/**
 * Which reasoning effort each conversation runs on.
 *
 * Stored in our own `session_meta` for the reason spelled out in
 * `src/lib/reasoning.ts`: Hermes accepts `model_options` on every turn but keeps
 * them request-scoped, so nothing upstream remembers the choice. Composing it
 * here rather than in the browser is the same rule the agent's `system_message`
 * follows — two tabs cannot end up disagreeing about how a conversation thinks.
 *
 * The column is created in `./db.ts`, before any statement below is prepared.
 */

const selReasoning = db.prepare<[string], { reasoning: string | null }>(
	'SELECT reasoning FROM session_meta WHERE session_id = ?'
);
const upsertReasoning = db.prepare(
	`INSERT INTO session_meta (session_id, reasoning, updated_at) VALUES (?, ?, ?)
	 ON CONFLICT(session_id) DO UPDATE SET reasoning = excluded.reasoning`
);
const selAllReasoning = db.prepare('SELECT session_id, reasoning FROM session_meta WHERE reasoning IS NOT NULL');

export const sessionReasoning = (sessionId: string): ReasoningEffort =>
	normalizeReasoning(selReasoning.get(sessionId)?.reasoning);

/**
 * Record the effort a conversation asks for.
 *
 * `auto` is stored as NULL rather than as the string: it is the absence of an
 * opinion, and a row that says nothing is what an untouched conversation has.
 * That also keeps `sessionReasoningMap()` to the conversations that deviate.
 */
export const setSessionReasoning = (sessionId: string, effort: ReasoningEffort): void => {
	upsertReasoning.run(sessionId, effort === DEFAULT_REASONING ? null : effort, Date.now() / 1000);
};

/** Every deviating conversation at once, for decorating a listing. */
export function sessionReasoningMap(): Map<string, ReasoningEffort> {
	const rows = selAllReasoning.all() as Array<{ session_id: string; reasoning: string }>;
	const out = new Map<string, ReasoningEffort>();
	for (const row of rows) {
		const effort = normalizeReasoning(row.reasoning);
		if (effort !== DEFAULT_REASONING) out.set(row.session_id, effort);
	}
	return out;
}

/** The `model_options` to send with this conversation's next turn, if any. */
export const reasoningForTurn = (sessionId: string): ReasoningModelOptions | undefined =>
	reasoningModelOptions(sessionReasoning(sessionId));
