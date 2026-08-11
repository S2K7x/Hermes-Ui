/**
 * What a turn's event stream *means* — the part that is pure logic.
 *
 * The server now consumes a turn to its end even when no browser is watching
 * (see `src/lib/server/turns.ts`), so it needs to know two things without a
 * client: what the agent finally said, and whether anyone saw it. Both live
 * here so they can be tested without a socket.
 */

/** Hard cap on the text we keep in memory per turn. A notification body is
 *  ~180 characters; anything beyond this is only ever thrown away. */
export const TURN_TEXT_CAP = 4000;

export interface TurnSummary {
	/** Assistant text so far — deltas, overwritten by `assistant.completed`. */
	text: string;
	/** Message from an `error` frame, if the turn failed. */
	error: string | null;
	/** True once `run.completed` or `assistant.completed` has been seen. */
	completed: boolean;
}

export const newTurnSummary = (): TurnSummary => ({ text: '', error: null, completed: false });

/**
 * Fold one SSE frame into the summary.
 *
 * `assistant.completed` is authoritative and replaces the accumulated deltas —
 * same rule the browser follows, because content resolved outside the token
 * stream (media turned into data: URLs) never appears as a delta.
 */
export function applyTurnFrame(
	summary: TurnSummary,
	event: string,
	data: Record<string, unknown>
): void {
	switch (event) {
		case 'assistant.delta':
			if (typeof data.delta === 'string' && summary.text.length < TURN_TEXT_CAP) {
				summary.text = (summary.text + data.delta).slice(0, TURN_TEXT_CAP);
			}
			break;
		case 'assistant.completed':
			if (typeof data.content === 'string' && data.content) {
				summary.text = data.content.slice(0, TURN_TEXT_CAP);
			}
			summary.completed = true;
			break;
		case 'run.completed':
			summary.completed = true;
			break;
		case 'error':
			if (typeof data.message === 'string' && data.message) summary.error = data.message;
			break;
	}
}

/** Last thing a browser told us about whether the app was on screen. */
export interface Presence {
	visible: boolean;
	/** Epoch seconds. Stale presence is ignored — see `shouldNotifyTurn`. */
	at: number;
}

/** How long a presence report is trusted, in seconds. */
export const PRESENCE_TTL_S = 600;

/**
 * Should a finished turn raise a push notification?
 *
 * Two independent signals, and either one saying "nobody is watching" is
 * enough:
 *
 * - `attached`: a browser was still reading the SSE stream when the turn
 *   ended. iOS suspends a backgrounded PWA and the connection dies, so this
 *   alone covers the phone case.
 * - `presence`: the last `visibilitychange` the app reported. A desktop tab in
 *   the background keeps its stream open, so `attached` would wrongly say the
 *   user saw the answer.
 *
 * Being permissive is deliberate: a notification the user did not need costs a
 * glance, a missing one costs the whole feature. Presence is global to the app
 * (single user), so a visible desktop tab silences nothing when the turn's own
 * reader has gone away.
 */
export function shouldNotifyTurn(input: {
	attached: boolean;
	presence: Presence | null;
	now: number;
}): boolean {
	if (!input.attached) return true;
	const presence = input.presence;
	if (!presence) return false;
	if (input.now - presence.at > PRESENCE_TTL_S) return false;
	return !presence.visible;
}
