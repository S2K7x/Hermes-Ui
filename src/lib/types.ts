/** Shapes returned by the Hermes API server (gateway/platforms/api_server.py). */

export interface HermesSession {
	id: string;
	source?: string;
	user_id?: string | null;
	model?: string | null;
	title?: string | null;
	started_at?: number;
	ended_at?: number | null;
	end_reason?: string | null;
	message_count?: number;
	tool_call_count?: number;
	input_tokens?: number;
	output_tokens?: number;
	estimated_cost_usd?: number | null;
	actual_cost_usd?: number | null;
	parent_session_id?: string | null;
	last_active?: number | null;
	preview?: string | null;
	pinned?: boolean;
	archived?: boolean;
	has_system_prompt?: boolean;
	has_model_config?: boolean;
	/**
	 * Set only on a row whose id was rotated by a context compression.
	 *
	 * `list_sessions_rich(project_compression_tips=True)` projects a compressed
	 * conversation forward onto its live continuation, so `id` above is the
	 * continuation's and this is the id the conversation started life with.
	 * Absent on every other row.
	 */
	_lineage_root_id?: string | null;
	/**
	 * The custom agent this conversation belongs to.
	 *
	 * NOT a Hermes field: the binding lives in this app's SQLite and the
	 * `/api/sessions*` proxy adds it to every row on the way out.
	 */
	agent_id?: string;
}

export interface HermesMessage {
	id?: number | string;
	session_id?: string;
	role: 'user' | 'assistant' | 'tool' | 'system';
	content?: string | null;
	tool_call_id?: string | null;
	tool_calls?: unknown;
	tool_name?: string | null;
	timestamp?: number;
	token_count?: number;
	finish_reason?: string | null;
	reasoning?: string | null;
	reasoning_content?: string | null;
}

export interface HermesCapabilities {
	object: string;
	platform: string;
	model: string;
	auth: { type: string; required: boolean };
	runtime: Record<string, unknown>;
	features: Record<string, boolean | string>;
	endpoints: Record<string, { method: string; path: string }>;
}

/** `runtime` block returned by the session model-lock endpoint. */
export interface SessionRuntime {
	provider: string;
	model: string;
	route_source: string;
	requested?: { provider: string; model: string };
	/** "accepted" once Hermes has confirmed the lock. */
	model_lock?: string;
}

export interface ModelOptions {
	model: string;
	provider: string;
	providers: Array<{
		slug: string;
		name: string;
		is_current: boolean;
		authenticated: boolean;
		models: string[];
		total_models: number;
		warning?: string;
	}>;
}

export interface ReadinessCheck {
	status: 'ok' | 'warn' | 'error' | string;
	[key: string]: unknown;
}

export interface HermesHealthDetailed {
	status: string;
	readiness: { status: string; checks: Record<string, ReadinessCheck> };
	platform: string;
	version: string;
	gateway_state: string | null;
	platforms: Record<string, { state?: string; error_code?: string | null }>;
	active_agents: number;
	gateway_busy: boolean;
	gateway_drainable: boolean;
	exit_reason: string | null;
	updated_at: string | null;
	pid: number;
}

/**
 * A cron job as `cron/jobs.py` stores it.
 *
 * Field names are the measured ones: `schedule` is an OBJECT
 * (`{kind, expr|minutes|run_at, display}`) and `schedule_display` is its human
 * form; `state` is the reconciled display state, not `paused`; the run stamps
 * are ISO strings named `*_run_at`, not `next_run` / `last_run`.
 */
export interface HermesJob {
	id?: string;
	name?: string;
	prompt?: string;
	schedule?: Record<string, unknown> | string;
	schedule_display?: string;
	state?: string;
	enabled?: boolean;
	deliver?: string;
	next_run_at?: string | null;
	last_run_at?: string | null;
	last_status?: string | null;
	last_error?: string | null;
	/**
	 * Added by this app from `job_meta`, not fields Hermes knows about: which
	 * agent the task belongs to, the instruction as typed (the stored prompt
	 * also carries the agent's card), and whether that card has since changed.
	 */
	agent_id?: string | null;
	instruction?: string;
	persona_stale?: boolean;
	[key: string]: unknown;
}

export interface StatusPayload {
	health: HermesHealthDetailed | null;
	healthError: string | null;
	jobs: HermesJob[];
	jobsAvailable: boolean;
	turns: { active: number; limit: number };
}

export interface HermesSkill {
	name: string;
	description?: string;
	category?: string;
}

export interface HermesToolset {
	name: string;
	label?: string;
	description?: string;
	enabled?: boolean;
	configured?: boolean;
	tools?: string[];
}

/** SSE event names emitted by POST /api/sessions/{id}/chat/stream. */
export type StreamEventName =
	| 'run.started'
	| 'message.started'
	| 'assistant.delta'
	| 'tool.progress'
	| 'tool.started'
	| 'tool.completed'
	| 'tool.failed'
	| 'assistant.completed'
	| 'run.completed'
	| 'error'
	| 'done';

export interface StreamEvent {
	event: StreamEventName | string;
	data: Record<string, any>;
}

/** A tool invocation as rendered in the agent timeline. */
export interface ToolStep {
	key: string;
	tool_name: string;
	status: 'running' | 'done' | 'failed';
	preview?: string | null;
	args?: unknown;
	result?: string | null;
	started_at: number;
	ended_at?: number;
}

/** Multimodal content part accepted by the Hermes session chat endpoints. */
export type ContentPart =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } };

export interface Attachment {
	id: string;
	name: string;
	mime: string;
	dataUrl: string;
	size: number;
}
