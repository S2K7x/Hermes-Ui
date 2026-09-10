/**
 * Recognising a turn that ended waiting for an approval nobody can give here.
 *
 * ## What actually happens, measured against Hermes 0.20.0
 *
 * A dangerous command goes through `check_all_command_guards`
 * (`tools/approval.py`). In a gateway context it looks for a per-session
 * notify callback — the thing that pops a native Approve/Deny prompt on
 * Telegram, Discord, or the CLI. **The Sessions API path registers none**:
 * `register_gateway_notify` is called only by `_handle_create_run`, the Runs
 * API handler. So the guard takes its fallback branch, records the request
 * with `submit_pending(session_key, …)` and returns
 *
 *     {approved: false, status: "pending_approval", approval_pending: true,
 *      command: "…", description: "…",
 *      message: "⚠️ <description>. Asking the user for approval.\n\n**Command:**…"}
 *
 * — and, crucially, **returns immediately**. Nothing blocks. The agent reads
 * that as its tool result, usually narrates "waiting for approval", and the
 * turn ends normally. By the time any of it is on screen there is no live
 * prompt left to answer: the moment is over.
 *
 * ## Why there is no Approve button, and why building one would be a lie
 *
 * The only endpoint that resolves an approval is
 * `POST /v1/runs/{run_id}/approval` (choices `once | session | always | deny`
 * — exactly the three the user wants). It resolves through
 * `self._run_approval_sessions[run_id]`, a map populated only by
 * `POST /v1/runs`. A conversation turn sent through
 * `/api/sessions/{id}/chat/stream` has no run_id in that map, so the endpoint
 * answers 404 `Run has no active approval session`.
 *
 * Moving the send path to the Runs API would buy real approvals and cost the
 * conversation: re-verified in 0.20.0, `_handle_runs` builds its history only
 * from the request body and never reads the session's transcript, flattening
 * whatever it is given with `str(content)` — no structured `tool_calls`, no
 * images. That is the trade point 2 of CLAUDE.md already refused.
 *
 * So this module does the one honest thing left: **name the dead end**. The
 * agent's own prose tends to invite the user to "approve in the confirmation
 * window", and no such window exists here — which is exactly the report that
 * prompted this. Detection keys on the upstream marker below, so if the
 * sentence ever changes the block simply stops appearing; it never invents a
 * control that does nothing.
 */

/**
 * The sentence `tools/approval.py` writes into the tool result, verbatim.
 *
 * Upstream constant, not a guess: it is a literal in the fallback branch that
 * runs when no notify callback is registered.
 */
const MARKER = 'Asking the user for approval';

export interface PendingApproval {
	/** The command Hermes refused to run unattended, already redacted upstream. */
	command: string;
	/** Why it was held: the dangerous-pattern description. */
	reason: string;
}

const FENCE = /\*\*Command:\*\*\s*```[a-z]*\n([\s\S]*?)```/;
const REASON = /⚠️\s*([^.]+?)\.\s*Asking the user for approval/;

/**
 * The approval a tool result is waiting on, or `null` when it is not one.
 *
 * Pure and total: any string is a valid input, and anything that does not
 * carry the upstream marker returns `null` rather than a half-parsed guess.
 */
export function pendingApproval(result: string | null | undefined): PendingApproval | null {
	if (!result || !result.includes(MARKER)) return null;

	const command = FENCE.exec(result)?.[1]?.trim() ?? '';
	// No command means the shape changed upstream. Showing a block that cannot
	// name what was blocked would be worse than showing nothing.
	if (!command) return null;

	const reason = REASON.exec(result)?.[1]?.trim() ?? '';
	return { command, reason };
}

/** The first step of a turn that ended waiting on an approval, if any. */
export function firstPendingApproval(
	steps: Array<{ result?: string | null }>
): PendingApproval | null {
	for (const step of steps) {
		const found = pendingApproval(step.result);
		if (found) return found;
	}
	return null;
}
