<script lang="ts">
	import { shortModelName } from '$lib/models';
	import { chat } from '$lib/stores/chat.svelte';
	import { menuKeydown } from '$lib/client/menu.svelte';

	let open = $state(false);
	let filter = $state('');
	let trigger = $state<HTMLButtonElement | null>(null);
	let menu = $state<HTMLDivElement | null>(null);

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

	/** Escape hands the focus back to the button the list came from. */
	function close(refocus = false) {
		open = false;
		if (refocus) trigger?.focus();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="picker"
	onkeydown={(event) => {
		if (open && menuKeydown(menu, event) === 'close') close(true);
	}}
>
	<button
		class="trigger"
		bind:this={trigger}
		onclick={(event) => {
			// Safari does not focus a clicked button; without this, Escape would
			// be typed at <body> and reach the page handler, where it means
			// "close the drawer" or "detach the running turn".
			event.currentTarget.focus();
			open = !open;
		}}
		aria-haspopup="true"
		aria-expanded={open}
		aria-label="Modèle : {chat.activeModel || 'aucun'}"
		title={chat.activeModel}
	>
		{short || 'modèle'}
		<span class="chev" aria-hidden="true">▾</span>
	</button>

	{#if open}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="scrim" onclick={() => close()}></div>
		<div class="menu" bind:this={menu}>
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
							close(true);
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
		padding: 7px 13px;
		font-size: 12.5px;
		color: var(--text-muted);
		background: var(--bg-raised);
		box-shadow: var(--shadow-card);
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
		padding: 9px;
		background: var(--bg-raised);
		border-radius: var(--radius-panel);
		box-shadow: var(--shadow-float);
	}
	.menu input {
		width: 100%;
		padding: 9px 13px;
		margin-bottom: 6px;
		background: var(--bg-sunken);
		border: none;
		border-radius: var(--radius-pill);
		font-size: 13px;
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
		padding: 9px 12px;
		border-radius: var(--radius-card);
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
	/* Thumb-sized rows on a phone, like every other control of the app. A
	   mis-tap here changes the model of the open conversation. */
	@media (max-width: 820px) {
		.menu input,
		.items button {
			min-height: 44px;
		}
	}
</style>
