import db, { getPref, setPref } from './db';
import { normalizeAgents, composeSystemPrompt, starterAgents, type Agent } from '$lib/agents';

/**
 * The agent roster and the conversation → agent binding.
 *
 * Both live in this app's SQLite, not in Hermes: the gateway has no notion of
 * a named persona, and its `sessions.system_prompt` column is write-only from
 * a turn's point of view (see the header of `src/lib/agents.ts`). Storing the
 * binding here is what lets the stream route re-send the right system prompt
 * on every single message without the browser being involved.
 */

db.exec(`
	CREATE TABLE IF NOT EXISTS agents (
		id           TEXT PRIMARY KEY,
		name         TEXT NOT NULL,
		emoji        TEXT NOT NULL DEFAULT '',
		color        TEXT NOT NULL DEFAULT '',
		role         TEXT NOT NULL DEFAULT '',
		prompt       TEXT NOT NULL DEFAULT '',
		model        TEXT NOT NULL DEFAULT '',
		orchestrator INTEGER NOT NULL DEFAULT 0,
		children     TEXT NOT NULL DEFAULT '[]',
		created_at   REAL NOT NULL,
		updated_at   REAL NOT NULL
	);
`);

// `session_meta` predates agents, so the column is added in place rather than
// by recreating the table: it already holds the title cache and the index of
// ids the archived view depends on.
const metaColumns = db.prepare('PRAGMA table_info(session_meta)').all() as Array<{ name: string }>;
if (!metaColumns.some((c) => c.name === 'agent_id')) {
	db.exec('ALTER TABLE session_meta ADD COLUMN agent_id TEXT');
}

interface AgentRow {
	id: string;
	name: string;
	emoji: string;
	color: string;
	role: string;
	prompt: string;
	model: string;
	orchestrator: number;
	children: string;
	created_at: number;
	updated_at: number;
}

// `rowid` breaks the tie rather than `id`: the four starter agents share a
// creation stamp, and their insertion order is the one that reads well
// (generalist first, then the lead and its specialists). Editing an agent
// leaves its rowid alone, so the list never reshuffles under the user.
const selAgents = db.prepare('SELECT * FROM agents ORDER BY created_at ASC, rowid ASC');
const upsertAgent = db.prepare(
	`INSERT INTO agents (id, name, emoji, color, role, prompt, model, orchestrator, children, created_at, updated_at)
	 VALUES (@id, @name, @emoji, @color, @role, @prompt, @model, @orchestrator, @children, @created_at, @updated_at)
	 ON CONFLICT(id) DO UPDATE SET
	   name = excluded.name,
	   emoji = excluded.emoji,
	   color = excluded.color,
	   role = excluded.role,
	   prompt = excluded.prompt,
	   model = excluded.model,
	   orchestrator = excluded.orchestrator,
	   children = excluded.children,
	   updated_at = excluded.updated_at`
);
const delAgent = db.prepare('DELETE FROM agents WHERE id = ?');
const setChildren = db.prepare('UPDATE agents SET children = ?, updated_at = ? WHERE id = ?');
const unbindAgent = db.prepare('UPDATE session_meta SET agent_id = NULL WHERE agent_id = ?');
const countAgents = db.prepare('SELECT COUNT(*) AS n FROM agents');

function fromRow(row: AgentRow): unknown {
	let children: unknown = [];
	try {
		children = JSON.parse(row.children);
	} catch {
		/* a hand-edited row must not take the roster down */
	}
	return { ...row, orchestrator: row.orchestrator === 1, children };
}

/**
 * The whole roster, repaired.
 *
 * `normalizeAgents` is what bounds the fields, drops references to agents that
 * were deleted, and breaks any loop — so nothing downstream, prompt
 * composition included, can recurse forever on a bad row.
 */
export function listAgents(): Agent[] {
	return normalizeAgents((selAgents.all() as AgentRow[]).map(fromRow));
}

export function saveAgent(agent: Agent): void {
	upsertAgent.run({
		id: agent.id,
		name: agent.name,
		emoji: agent.emoji,
		color: agent.color,
		role: agent.role,
		prompt: agent.prompt,
		model: agent.model,
		orchestrator: agent.orchestrator ? 1 : 0,
		children: JSON.stringify(agent.children),
		created_at: agent.created_at,
		updated_at: agent.updated_at
	});
}

/**
 * Delete an agent and every reference to it.
 *
 * Leaving a dangling id in someone's team would be silently harmless —
 * `normalizeAgents` prunes it on read — but the row would keep coming back on
 * every save round-trip. Conversations that belonged to it lose their persona
 * and fall back to Hermes' default prompt; the transcript is untouched.
 */
export const removeAgent = db.transaction((id: string): boolean => {
	const gone = delAgent.run(id).changes > 0;
	if (!gone) return false;
	const now = Date.now() / 1000;
	for (const agent of listAgents()) {
		if (!agent.children.includes(id)) continue;
		setChildren.run(JSON.stringify(agent.children.filter((c) => c !== id)), now, agent.id);
	}
	unbindAgent.run(id);
	return true;
});

// ---------------------------------------------------------------------------
// Which agent owns which conversation
// ---------------------------------------------------------------------------

const bindStmt = db.prepare(
	`INSERT INTO session_meta (session_id, agent_id, updated_at) VALUES (?, ?, ?)
	 ON CONFLICT(session_id) DO UPDATE SET agent_id = excluded.agent_id`
);
const selSessionAgent = db.prepare<[string], { agent_id: string | null }>(
	'SELECT agent_id FROM session_meta WHERE session_id = ?'
);
const selBindings = db.prepare('SELECT session_id, agent_id FROM session_meta WHERE agent_id IS NOT NULL');

export const bindSessionAgent = (sessionId: string, agentId: string | null): void => {
	bindStmt.run(sessionId, agentId, Date.now() / 1000);
};

export const sessionAgentId = (sessionId: string): string | null =>
	selSessionAgent.get(sessionId)?.agent_id ?? null;

/** Every binding at once — cheaper than one query per row when decorating a list. */
export function sessionAgentMap(): Map<string, string> {
	const rows = selBindings.all() as Array<{ session_id: string; agent_id: string }>;
	return new Map(rows.map((r) => [r.session_id, r.agent_id]));
}

/**
 * The `system_message` to send with this conversation's next turn.
 *
 * `undefined` when the conversation has no agent, or its agent was deleted:
 * Hermes then uses its own default prompt, which is exactly what the app did
 * before agents existed.
 */
export function systemPromptForSession(sessionId: string): string | undefined {
	const agentId = sessionAgentId(sessionId);
	if (!agentId) return undefined;
	const prompt = composeSystemPrompt(listAgents(), agentId);
	return prompt || undefined;
}

/** The agent a new conversation should run on, if it still exists. */
export function findAgent(id: string | undefined | null): Agent | undefined {
	if (!id) return undefined;
	return listAgents().find((a) => a.id === id);
}

// ---------------------------------------------------------------------------
// Starter team
// ---------------------------------------------------------------------------

/**
 * Seed four example agents the first time this database is used.
 *
 * Guarded by a pref flag rather than by "is the table empty", so deleting all
 * four is a decision that sticks instead of being undone on the next restart.
 */
const SEED_KEY = 'agents_seeded';

if (!getPref(SEED_KEY, false) && (countAgents.get() as { n: number }).n === 0) {
	const seed = db.transaction(() => {
		for (const agent of starterAgents(Date.now() / 1000)) saveAgent(agent);
		setPref(SEED_KEY, true);
	});
	seed();
}
