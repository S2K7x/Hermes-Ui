<script lang="ts">
	interface Props {
		open: boolean;
		onclose: () => void;
	}
	let { open, onclose }: Props = $props();

	import { modKey } from '$lib/client/platform';

	let mod = $state('Ctrl');
	$effect(() => {
		mod = modKey();
	});

	let rows = $derived([
		[`${mod} K`, 'Palette : rechercher une conversation ou une action'],
		[`${mod} ⇧ O`, 'Nouvelle discussion'],
		[`${mod} /`, 'État du système'],
		['/', 'Focus sur le composeur (puis / ouvre les skills)'],
		['↵', 'Envoyer · ⇧↵ retour à la ligne'],
		['Échap', 'Fermer un panneau, ou détacher le tour en cours'],
		['?', 'Cette aide']
	]);
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="scrim" onclick={onclose}></div>
	<div class="panel" role="dialog" aria-modal="true" aria-label="Raccourcis clavier">
		<header>
			<h2>Raccourcis clavier</h2>
			<button class="x" onclick={onclose} aria-label="Fermer">✕</button>
		</header>
		<ul>
			{#each rows as [keys, label] (label)}
				<li>
					<kbd>{keys}</kbd>
					<span>{label}</span>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 150;
		background: rgba(0, 0, 0, 0.5);
	}
	.panel {
		position: fixed;
		z-index: 151;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(460px, calc(100vw - 24px));
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: 14px;
		box-shadow: var(--shadow);
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border-soft);
	}
	h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
	}
	.x {
		color: var(--text-faint);
		padding: 2px 6px;
	}
	ul {
		margin: 0;
		padding: 10px 16px 16px;
		list-style: none;
	}
	li {
		display: flex;
		align-items: baseline;
		gap: 12px;
		padding: 6px 0;
		font-size: 13.5px;
		color: var(--text-muted);
	}
	kbd {
		flex: 0 0 96px;
		font-family: inherit;
		font-size: 12px;
		color: var(--text);
		text-align: right;
		white-space: nowrap;
	}
</style>
