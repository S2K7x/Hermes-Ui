<script lang="ts">
	import Modal from './Modal.svelte';

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

<Modal {open} title="Raccourcis clavier" width={460} {onclose}>
	<ul>
		{#each rows as [keys, label] (label)}
			<li>
				<kbd>{keys}</kbd>
				<span>{label}</span>
			</li>
		{/each}
	</ul>
</Modal>

<style>
	ul {
		margin: 0;
		padding: 10px 16px 16px;
		list-style: none;
		overflow-y: auto;
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
