<script lang="ts">
	import Modal from './Modal.svelte';
	import Icon from './Icon.svelte';
	import { approvals } from '$lib/stores/approvals.svelte';
	import { APPROVAL_MODES, modeStrandsWebUi, type ApprovalMode } from '$lib/approvals';

	interface Props {
		open: boolean;
		onclose: () => void;
	}
	let { open, onclose }: Props = $props();

	let denyDraft = $state('');
	let allowDraft = $state('');

	// Opening is the natural moment to retry a failed read, exactly like the
	// appearance and providers panels.
	$effect(() => {
		if (open) void approvals.ensureLoaded();
	});
	let blocked = $derived(!approvals.available || approvals.saving);

	const MODES: Record<ApprovalMode, { label: string; hint: string }> = {
		smart: {
			label: 'Intelligent',
			hint: "Un modèle auxiliaire juge chaque commande dangereuse et approuve la plupart. C'est le défaut."
		},
		manual: {
			label: 'Manuel',
			hint: 'Chaque commande dangereuse demande une approbation humaine.'
		},
		off: {
			label: 'Désactivé',
			hint: 'Plus aucune approbation demandée, sur aucune surface.'
		}
	};

	async function setMode(mode: ApprovalMode) {
		if (mode === approvals.policy.mode) return;
		if (mode === 'off') {
			const ok = confirm(
				"Désactiver les approbations ?\n\nPlus aucune commande dangereuse ne sera soumise à approbation — ni ici, ni depuis le CLI, ni depuis Telegram, ni pour les tâches planifiées. Le plancher de sécurité de Hermes (rm -rf /, mkfs, écriture disque brute…) reste en place, mais tout le reste passe sans question."
			);
			if (!ok) return;
		}
		await approvals.setMode(mode);
	}

	async function addDeny() {
		const value = denyDraft;
		denyDraft = '';
		await approvals.addRule('deny', value);
	}
	async function addAllow() {
		const value = allowDraft;
		allowDraft = '';
		await approvals.addRule('allowlist', value);
	}

	function onKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<Modal {open} title="Approbations" width={560} {onclose}>
	{#snippet subtitle()}Ce que Yadai peut lancer sans demander{/snippet}
	<div class="body">
		{#if !approvals.available}
			<p class="fail">
				{approvals.message || (approvals.loading ? 'Lecture…' : "La politique n'a pas pu être lue.")}
			</p>
			{#if !approvals.loading}
				<button class="retry" onclick={() => approvals.load()}>Réessayer</button>
			{/if}
		{/if}

		<h3>Mode</h3>
		<div class="modes">
			{#each APPROVAL_MODES as mode (mode)}
				<button
					class="mode"
					class:sel={approvals.policy.mode === mode}
					class:danger={mode === 'off'}
					disabled={blocked}
					onclick={() => setMode(mode)}
				>
					<span class="m-name">{MODES[mode].label}</span>
					<span class="m-hint">{MODES[mode].hint}</span>
				</button>
			{/each}
		</div>

		{#if modeStrandsWebUi(approvals.policy.mode)}
			<!-- The one thing this panel exists to make visible: in manual mode the
			     web UI cannot answer its own prompts, so every dangerous command
			     becomes a dead end here. See $lib/approvals for the measurement. -->
			<p class="warn">
				<Icon name="warning" size={15} /> En mode manuel, cette interface ne peut accorder
				aucune approbation : Hermes n'expose de bouton que sur le CLI et les messageries. Une
				commande dangereuse s'arrêtera donc ici sans recours. Le mode intelligent, lui, tranche
				tout seul.
			</p>
		{/if}

		<h3>Toujours refuser</h3>
		<p class="lead">
			Motifs <code>fnmatch</code> bloqués <strong>sans condition</strong>, avant même le mode
			ci-dessus. Un refus ici gagne contre tout le reste. Prise en compte immédiate.
		</p>
		<div class="add">
			<input
				bind:value={denyDraft}
				placeholder="git push --force*"
				disabled={blocked}
				onkeydown={(e) => e.key === 'Enter' && addDeny()}
				aria-label="Nouveau motif à refuser"
			/>
			<button disabled={blocked || !denyDraft.trim()} onclick={addDeny}>Ajouter</button>
		</div>
		<ul class="rules">
			{#each approvals.policy.deny as rule (rule)}
				<li>
					<code>{rule}</code>
					<button
						disabled={blocked}
						onclick={() => approvals.removeRule('deny', rule)}
						aria-label="Retirer {rule}"><Icon name="close" size={13} /></button
					>
				</li>
			{:else}
				<li class="none">Aucun motif refusé.</li>
			{/each}
		</ul>

		<h3>Toujours autoriser</h3>
		<p class="lead">
			Commandes approuvées une fois pour toutes — texte exact ou joker
			(<code>podman *</code>). <strong>Nécessite un redémarrage du gateway</strong> :
			cette liste n'est lue qu'au démarrage de Hermes, contrairement aux deux réglages
			ci-dessus.
		</p>
		<div class="add">
			<input
				bind:value={allowDraft}
				placeholder="docker compose ps"
				disabled={blocked}
				onkeydown={(e) => e.key === 'Enter' && addAllow()}
				aria-label="Nouvelle commande à autoriser"
			/>
			<button disabled={blocked || !allowDraft.trim()} onclick={addAllow}>Ajouter</button>
		</div>
		<ul class="rules">
			{#each approvals.policy.allowlist as rule (rule)}
				<li>
					<code>{rule}</code>
					<button
						disabled={blocked}
						onclick={() => approvals.removeRule('allowlist', rule)}
						aria-label="Retirer {rule}"><Icon name="close" size={13} /></button
					>
				</li>
			{:else}
				<li class="none">Aucune commande pré-autorisée.</li>
			{/each}
		</ul>

		<p class="lead foot">
			Ces réglages sont ceux de Hermes, pas de cette interface : ils valent aussi pour le CLI,
			les messageries et les tâches planifiées. Après un ajout à « toujours autoriser » :
			<code>systemctl --user restart hermes-gateway</code>.
		</p>
		<!-- Constaté en écrivant ce panneau, pas déduit : la sauvegarde passe par
		     le dashboard, qui ré-sérialise config.yaml et ne conserve pas les
		     commentaires écrits à la main. Mieux vaut le dire ici que le
		     découvrir. -->
		<p class="lead">
			<Icon name="warning" size={13} /> Enregistrer réécrit <code>~/.hermes/config.yaml</code> via
			le dashboard de Hermes, qui ne conserve pas les commentaires que vous y auriez écrits.
		</p>
	</div>
</Modal>

<style>
	.body {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 4px 16px 18px;
	}
	h3 {
		margin: 20px 0 8px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
	h3:first-child {
		margin-top: 6px;
	}
	.fail {
		margin: 8px 0 6px;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--danger);
	}
	.retry {
		margin-bottom: 4px;
		font-size: 13px;
		color: var(--accent);
	}
	.lead {
		margin: 0 0 10px;
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--text-faint);
	}
	.lead code,
	.rules code {
		font-family: ui-monospace, Menlo, Consolas, monospace;
		font-size: 11.5px;
		padding: 1px 5px;
		border-radius: 5px;
		background: var(--code-bg);
	}
	.foot {
		margin-top: 18px;
	}
	.modes {
		display: flex;
		flex-direction: column;
		gap: var(--gap-card);
	}
	.mode {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 11px 14px;
		min-height: 56px;
		text-align: left;
		background: var(--bg-sunken);
		border: 1px solid transparent;
		border-radius: var(--radius-card);
	}
	.mode:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.mode.sel {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.mode.danger.sel {
		border-color: var(--danger);
		background: var(--danger-soft);
	}
	.mode:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.m-name {
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
	}
	.m-hint {
		font-size: 12px;
		color: var(--text-faint);
		line-height: 1.45;
	}
	.warn {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin: 12px 0 0;
		padding: 11px 14px;
		border-radius: var(--radius-card);
		background: var(--danger-soft);
		color: var(--danger);
		font-size: 12.5px;
		line-height: 1.55;
	}
	.add {
		display: flex;
		gap: 8px;
		margin-bottom: 10px;
	}
	.add input {
		flex: 1;
		min-width: 0;
		min-height: 44px;
		padding: 10px 14px;
		background: var(--bg-sunken);
		border: none;
		border-radius: var(--radius-pill);
		font-size: 13px;
	}
	.add button {
		flex: 0 0 auto;
		min-height: 44px;
		padding: 8px 16px;
		border-radius: var(--radius-pill);
		background: var(--accent-2);
		color: var(--accent-2-ink);
		font-size: 13px;
		font-weight: 600;
	}
	.add button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.rules {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.rules li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 8px 7px 12px;
		background: var(--bg-sunken);
		border-radius: var(--radius-card);
	}
	.rules li code {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		background: none;
		padding: 0;
	}
	.rules li button {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		color: var(--text-faint);
	}
	.rules li button:hover:not(:disabled) {
		background: var(--danger-soft);
		color: var(--danger);
	}
	.none {
		color: var(--text-faint);
		font-size: 12.5px;
	}

	@media (max-width: 820px) {
		.rules li button {
			width: 44px;
			height: 44px;
		}
	}
</style>
