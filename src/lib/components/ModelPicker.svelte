<script lang="ts">
	import { shortModelName } from '$lib/models';
	import { chat } from '$lib/stores/chat.svelte';

	let open = $state(false);
	let filter = $state('');

	// Only providers with credentials can actually serve a turn.
	let usable = $derived((chat.models?.providers ?? []).filter((p) => p.authenticated && p.models.length));
	let entries = $derived(
		usable.flatMap((p) => p.models.map((m) => ({ provider: p.slug, providerName: p.name, model: m })))
	);
	let matches = $derived(
		filter.trim()
			? entries.filter((e) => e.model.toLowerCase().includes(filter.toLowerCase())).slice(0, 60)
			: entries.slice(0, 60)
	);

	let short = $derived(shortModelName(chat.activeModel));
	/** A gateway too old to expose POST /api/sessions/{id}/model still pins the
	 *  model at session creation: the choice only lands on the next discussion. */
	let deferred = $derived(Boolean(chat.sessionId) && !chat.canSwitchModel);
</script>

<div class="picker">
	<button class="trigger" onclick={() => (open = !open)} title={chat.activeModel}>
		{short || 'modèle'}
		<span class="chev">▾</span>
	</button>

	{#if open}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="scrim" onclick={() => (open = false)}></div>
		<div class="menu">
			{#if deferred}
				<p class="hint">
					Ce gateway fige le modèle par conversation : ce choix s'appliquera à la prochaine
					discussion.
				</p>
			{:else if chat.sessionId}
				<p class="hint">
					Le modèle choisi s'applique à cette conversation dès le prochain message.
				</p>
			{/if}
			<input bind:value={filter} placeholder="Filtrer…" type="search" />
			<div class="items">
				{#each matches as entry (entry.provider + entry.model)}
					<button
						class:sel={entry.model === chat.activeModel}
						onclick={() => {
							chat.setModel(entry.model);
							open = false;
						}}
					>
						<span class="m">{entry.model}</span>
						<span class="p">{entry.providerName}</span>
					</button>
				{/each}
				{#if matches.length === 0}
					<p class="hint">Aucun modèle disponible. Configurez un fournisseur avec `hermes model`.</p>
				{/if}
			</div>
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
		border-radius: var(--radius-pill);
		max-width: 190px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.trigger:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.chev {
		font-size: 9px;
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
		width: min(340px, 88vw);
		padding: 8px;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow);
	}
	.menu input {
		width: 100%;
		padding: 6px 9px;
		margin-bottom: 6px;
		background: var(--bg);
		border: 1px solid var(--border-soft);
		border-radius: 10px;
		font-size: 13px;
		outline: none;
	}
	.items {
		display: flex;
		flex-direction: column;
		max-height: 320px;
		overflow-y: auto;
	}
	.items button {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding: 6px 9px;
		border-radius: 10px;
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
	.m {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.p {
		flex: 0 0 auto;
		font-size: 11px;
		color: var(--text-faint);
	}
	.hint {
		margin: 0 0 6px;
		padding: 6px 9px;
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-muted);
		background: var(--bg-sunken);
		border-radius: 10px;
	}
</style>
