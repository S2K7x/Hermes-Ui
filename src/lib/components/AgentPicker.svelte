<script lang="ts">
	import { agents } from '$lib/stores/agents.svelte';
	import { chat } from '$lib/stores/chat.svelte';
	import { agentColor, agentLabel, directReports } from '$lib/agents';

	interface Props {
		/** Opens the editor — the picker only picks. */
		onmanage: () => void;
	}
	let { onmanage }: Props = $props();

	let open = $state(false);

	let active = $derived(agents.byId(chat.activeAgentId));
	let reports = $derived(active ? directReports(agents.items, active) : []);

	function choose(id: string) {
		chat.setAgent(id);
		open = false;
	}
</script>

<div class="picker">
	<button
		class="trigger"
		style="--agent: {active ? agentColor(active) : 'var(--text-faint)'}"
		onclick={() => (open = !open)}
		title={active ? `Agent : ${active.name}` : 'Aucun agent — prompt par défaut de Hermes'}
	>
		<span class="dot"></span>
		<span class="label">{active ? agentLabel(active) : 'Agent'}</span>
		<span class="mini">{active ? active.emoji || '●' : 'Agent'}</span>
		<span class="chev">▾</span>
	</button>

	{#if open}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="scrim" onclick={() => (open = false)}></div>
		<div class="menu">
			<p class="hint">
				{#if chat.sessionId}
					L'agent choisi prend la main sur cette conversation dès le prochain message.
				{:else}
					L'agent choisi démarrera la prochaine discussion.
				{/if}
			</p>
			<div class="items">
				<button class:sel={!chat.activeAgentId} onclick={() => choose('')}>
					<span class="n">Sans agent</span>
					<span class="j">prompt par défaut de Hermes</span>
				</button>
				{#each agents.items as agent (agent.id)}
					<button
						class:sel={agent.id === chat.activeAgentId}
						style="--agent: {agentColor(agent)}"
						onclick={() => choose(agent.id)}
					>
						<span class="n"><span class="dot"></span>{agentLabel(agent)}</span>
						{#if agent.role}<span class="j">{agent.role}</span>{/if}
					</button>
				{/each}
			</div>
			{#if reports.length > 0}
				<p class="hint team">
					{active?.name} peut déléguer à {reports.map((a) => a.name).join(', ')}.
				</p>
			{/if}
			<button class="manage" onclick={() => { open = false; onmanage(); }}>Gérer l'équipe…</button>
		</div>
	{/if}
</div>

<style>
	.picker {
		position: relative;
	}
	.trigger {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 10px;
		font-size: 12.5px;
		color: var(--text-muted);
		border: 1px solid var(--border-soft);
		border-radius: 20px;
		max-width: 170px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.trigger:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.dot {
		flex: 0 0 auto;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--agent);
		margin-right: 2px;
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mini {
		display: none;
	}
	.chev {
		font-size: 9px;
	}
	/* The header carries two pickers plus three icons; on a phone the agent
	   shrinks to its emoji so the conversation title keeps some room. */
	@media (max-width: 700px) {
		.trigger {
			padding: 4px 8px;
		}
		.label {
			display: none;
		}
		.mini {
			display: inline;
		}
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
	}
	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		z-index: 31;
		width: min(320px, 88vw);
		padding: 8px;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: var(--shadow);
	}
	.items {
		display: flex;
		flex-direction: column;
		max-height: 320px;
		overflow-y: auto;
	}
	.items button {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 6px 9px;
		border-radius: 7px;
		text-align: left;
		font-size: 13px;
	}
	.items button:hover {
		background: var(--bg-hover);
	}
	.items button.sel {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.n {
		display: flex;
		align-items: center;
		gap: 5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.j {
		font-size: 11px;
		color: var(--text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hint {
		margin: 0 0 6px;
		padding: 6px 9px;
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-muted);
		background: var(--bg-sunken);
		border-radius: 7px;
	}
	.hint.team {
		margin: 6px 0 0;
	}
	.manage {
		width: 100%;
		margin-top: 6px;
		padding: 6px 9px;
		border-top: 1px solid var(--border-soft);
		font-size: 12.5px;
		color: var(--text-muted);
		text-align: left;
	}
	.manage:hover {
		color: var(--text);
	}
</style>
