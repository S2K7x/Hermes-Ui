<script lang="ts">
	import { providersStore } from '$lib/stores/providers.svelte';
	import { chat } from '$lib/stores/chat.svelte';
	import {
		accountSummary,
		filterProviderGroups,
		flowKind,
		isConnected,
		isGroupConfigured,
		secondsLeft,
		type OauthProvider
	} from '$lib/providers';
	import { shortModelName } from '$lib/models';

	interface Props {
		open: boolean;
		onclose: () => void;
	}
	let { open, onclose }: Props = $props();

	type Tab = 'keys' | 'accounts' | 'model';
	let tab = $state<Tab>('keys');
	let query = $state('');

	// Load once per opening. Listing providers costs two dashboard calls, one of
	// which walks the credential store — not something to repeat on a Pi while
	// the panel just sits there.
	$effect(() => {
		if (open && providersStore.available === null) providersStore.refresh();
	});

	let groups = $derived(filterProviderGroups(providersStore.keys, query));

	// Only providers Hermes can actually route to are offered as a default:
	// picking an unauthenticated one guarantees a failed turn.
	let usableProviders = $derived(
		(chat.models?.providers ?? []).filter((p) => p.authenticated && p.models.length > 0)
	);
	let modelProvider = $state('');
	let modelName = $state('');

	$effect(() => {
		if (!modelProvider && chat.models?.provider) modelProvider = chat.models.provider;
	});
	let providerModels = $derived(
		usableProviders.find((p) => p.slug === modelProvider)?.models ?? []
	);
	$effect(() => {
		if (providerModels.length && !providerModels.includes(modelName)) {
			modelName = providerModels.includes(chat.models?.model ?? '')
				? (chat.models?.model ?? '')
				: providerModels[0];
		}
	});

	let flow = $derived(providersStore.flow);
	let remaining = $derived(flow ? secondsLeft(flow, providersStore.now) : 0);

	function close() {
		// Leave the pending login alone rather than cancelling it silently: the
		// user may be finishing the flow in another tab.
		onclose();
	}

	function onKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
		}
	}

	function accountAction(provider: OauthProvider): string {
		return flowKind(provider) === 'external' ? 'Via la CLI' : 'Connecter';
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="scrim" onclick={close}></div>
	<div class="panel" role="dialog" aria-modal="true" aria-label="Providers">
		<header>
			<h2>Providers</h2>
			<span class="muted small">
				{#if providersStore.available === false}
					indisponible
				{:else}
					clés et comptes de Hermes · un redémarrage du gateway peut être nécessaire
				{/if}
			</span>
			<button class="x" onclick={close} aria-label="Fermer">✕</button>
		</header>

		{#if providersStore.available === false}
			<div class="unavailable">
				<p>La gestion des providers est indisponible.</p>
				<p class="muted small">{providersStore.message}</p>
				<p class="muted small">
					Le dashboard de Hermes tourne en service utilisateur
					(<code>systemctl --user status hermes-dashboard</code>) sur
					<code>127.0.0.1:9119</code>. Son jeton est
					<code>HERMES_DASHBOARD_SESSION_TOKEN</code> dans
					<code>~/.hermes/dashboard.env</code> ; recopiez-le dans
					<code>HERMES_DASHBOARD_TOKEN</code>.
				</p>
				<button onclick={() => providersStore.refresh()}>Réessayer</button>
			</div>
		{:else}
			<nav class="tabs">
				<button class:sel={tab === 'keys'} onclick={() => (tab = 'keys')}>Clés API</button>
				<button class:sel={tab === 'accounts'} onclick={() => (tab = 'accounts')}>Comptes</button>
				<button class:sel={tab === 'model'} onclick={() => (tab = 'model')}>
					Modèle par défaut
				</button>
			</nav>

			<div class="body">
				{#if providersStore.loading && providersStore.keys.length === 0}
					<p class="none">Chargement…</p>
				{:else if tab === 'keys'}
					<div class="tools">
						<input
							bind:value={query}
							placeholder="Filtrer un fournisseur…"
							aria-label="Filtrer les fournisseurs"
							type="search"
						/>
					</div>

					{#if groups.length === 0}
						<p class="none">Aucun fournisseur ne correspond.</p>
					{/if}

					{#each groups as group (group.provider)}
						<section class="card">
							<div class="card-head">
								<span class="name">{group.label}</span>
								<span class="pill" class:on={isGroupConfigured(group)}>
									{isGroupConfigured(group) ? 'Configuré' : 'Non configuré'}
								</span>
							</div>
							{#each group.keys as entry (entry.key)}
								<div class="var">
									<div class="var-head">
										<code>{entry.key}</code>
										{#if entry.isSet}
											<span class="redacted">{entry.redacted ?? '••••'}</span>
										{:else}
											<span class="muted small">non renseignée</span>
										{/if}
										<span class="spacer"></span>
										{#if providersStore.editing !== entry.key}
											<button onclick={() => providersStore.edit(entry.key)}>
												{entry.isSet ? 'Remplacer' : 'Renseigner'}
											</button>
											{#if entry.isSet}
												<button
													class="danger"
													disabled={providersStore.saving}
													onclick={() => {
														if (confirm(`Supprimer ${entry.key} de la configuration de Hermes ?`))
															providersStore.deleteKey(entry.key);
													}}>Supprimer</button
												>
											{/if}
										{/if}
									</div>

									{#if entry.description}
										<p class="muted small desc">
											{entry.description}
											{#if entry.url}
												· <a href={entry.url} target="_blank" rel="noreferrer noopener">
													obtenir une clé
												</a>
											{/if}
										</p>
									{/if}

									{#if providersStore.editing === entry.key}
										<div class="editor">
											<!-- svelte-ignore a11y_autofocus -->
											<input
												type="password"
												autocomplete="off"
												spellcheck="false"
												autofocus
												bind:value={providersStore.draft}
												placeholder="Collez la clé"
												aria-label={`Valeur de ${entry.key}`}
												onkeydown={(e) => {
													if (e.key === 'Enter') providersStore.saveKey();
												}}
											/>
											<button
												disabled={!providersStore.draft.trim() || providersStore.validating}
												onclick={() => providersStore.validate()}
											>
												{providersStore.validating ? 'Vérification…' : 'Vérifier'}
											</button>
											<button
												class="primary"
												disabled={!providersStore.draft.trim() || providersStore.saving}
												onclick={() => providersStore.saveKey()}
											>
												{providersStore.saving ? 'Enregistrement…' : 'Enregistrer'}
											</button>
											<button onclick={() => providersStore.cancelEdit()}>Annuler</button>
										</div>
										{#if providersStore.validationHint}
											<p class="muted small">{providersStore.validationHint}</p>
										{/if}
										<p class="muted small">
											La clé est écrite dans <code>~/.hermes/.env</code> par Hermes lui-même, qui
											met aussi à jour les copies de <code>config.yaml</code>. Elle n'est jamais
											renvoyée en clair à ce navigateur.
										</p>
									{/if}
								</div>
							{/each}
						</section>
					{/each}
				{:else if tab === 'accounts'}
					{#if flow}
						<section class="card flow">
							<div class="card-head">
								<span class="name">{flow.providerName}</span>
								{#if flow.phase === 'awaiting'}
									<span class="pill">expire dans {Math.floor(remaining / 60)} min {remaining % 60}s</span>
								{/if}
							</div>

							{#if flow.phase === 'awaiting' && flow.kind === 'device_code'}
								<p>
									Ouvrez
									<a href={flow.verificationUrl} target="_blank" rel="noreferrer noopener">
										{flow.verificationUrl}
									</a>
									et saisissez ce code :
								</p>
								<p class="code">{flow.userCode}</p>
								<p class="muted small">
									Cette page interroge Hermes toutes les
									{Math.round(flow.pollIntervalMs / 1000)} s jusqu'à ce que le fournisseur réponde.
								</p>
							{:else if flow.phase === 'awaiting'}
								<p>
									Ouvrez
									<a href={flow.authUrl} target="_blank" rel="noreferrer noopener">
										la page d'autorisation
									</a>, puis collez ici le code affiché à la fin :
								</p>
								<div class="editor">
									<input
										bind:value={providersStore.code}
										placeholder="Code d'autorisation"
										aria-label="Code d'autorisation"
										spellcheck="false"
									/>
									<button
										class="primary"
										disabled={!providersStore.code.trim() || providersStore.submitting}
										onclick={() => providersStore.submitCode()}
									>
										{providersStore.submitting ? 'Validation…' : 'Valider'}
									</button>
								</div>
							{:else}
								<p class:ok={flow.phase === 'approved'} class:ko={flow.phase !== 'approved'}>
									{flow.message}
								</p>
							{/if}

							<div class="actions">
								<button onclick={() => providersStore.cancelFlow()}>
									{flow.phase === 'awaiting' ? 'Annuler' : 'Fermer'}
								</button>
							</div>
						</section>
					{/if}

					{#each providersStore.accounts as provider (provider.id)}
						<section class="card">
							<div class="card-head">
								<span class="name">{provider.name}</span>
								<span class="pill" class:on={isConnected(provider)}>
									{isConnected(provider) ? 'Connecté' : 'Non connecté'}
								</span>
							</div>
							<p class="muted small desc">
								{accountSummary(provider)}
								{#if provider.docs_url}
									· <a href={provider.docs_url} target="_blank" rel="noreferrer noopener">docs</a>
								{/if}
							</p>

							{#if flowKind(provider) === 'external'}
								<p class="muted small">
									Lancez <code>{provider.cli_command}</code> sur le Pi : Hermes ne peut pas
									piloter ce flux à sa place.
								</p>
							{/if}

							<div class="actions">
								{#if !isConnected(provider) && flowKind(provider) !== 'external'}
									<button
										class="primary"
										disabled={!!flow || providersStore.starting !== null}
										onclick={() => providersStore.startOauth(provider)}
									>
										{providersStore.starting === provider.id ? 'Démarrage…' : accountAction(provider)}
									</button>
								{/if}
								{#if isConnected(provider) && provider.disconnectable}
									<button
										class="danger"
										disabled={providersStore.saving}
										onclick={() => {
											if (confirm(`Déconnecter ${provider.name} ?`)) providersStore.disconnect(provider);
										}}>Déconnecter</button
									>
								{:else if isConnected(provider) && provider.disconnect_command}
									<span class="muted small">
										Pour déconnecter : <code>{provider.disconnect_command}</code>
									</span>
								{:else if isConnected(provider) && provider.disconnect_hint}
									<span class="muted small">{provider.disconnect_hint}</span>
								{/if}
							</div>
						</section>
					{/each}
				{:else}
					<section class="card">
						<div class="card-head">
							<span class="name">Modèle par défaut de Hermes</span>
							{#if chat.models}
								<span class="pill on">{shortModelName(chat.models.model)}</span>
							{/if}
						</div>
						<p class="muted small desc">
							Écrit dans <code>config.yaml</code> et appliqué aux <strong>nouvelles</strong>
							discussions. Pour changer le modèle de la conversation ouverte, utilisez le sélecteur
							en haut de l'écran.
						</p>

						{#if usableProviders.length === 0}
							<p class="muted small">
								Aucun fournisseur authentifié pour l'instant. Renseignez une clé ou connectez un
								compte dans les autres onglets.
							</p>
						{:else}
							<div class="editor">
								<select bind:value={modelProvider} aria-label="Fournisseur">
									{#each usableProviders as provider (provider.slug)}
										<option value={provider.slug}>{provider.name}</option>
									{/each}
								</select>
								<select bind:value={modelName} aria-label="Modèle">
									{#each providerModels as model (model)}
										<option value={model}>{model}</option>
									{/each}
								</select>
								<button
									class="primary"
									disabled={!modelName || providersStore.switchingModel}
									onclick={() => providersStore.setDefaultModel(modelProvider, modelName)}
								>
									{providersStore.switchingModel ? 'Application…' : 'Définir par défaut'}
								</button>
							</div>
						{/if}

						{#if providersStore.confirmModel}
							<div class="warn">
								<p>{providersStore.confirmModel.message}</p>
								<div class="actions">
									<button onclick={() => providersStore.dismissConfirm()}>Annuler</button>
									<button
										class="primary"
										disabled={providersStore.switchingModel}
										onclick={() =>
											providersStore.setDefaultModel(
												providersStore.confirmModel!.provider,
												providersStore.confirmModel!.model,
												true
											)}>Confirmer quand même</button
									>
								</div>
							</div>
						{/if}
					</section>
				{/if}
			</div>
		{/if}
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
		width: min(760px, calc(100vw - 20px));
		height: min(88vh, calc(100dvh - 20px));
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: 14px;
		box-shadow: var(--shadow);
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border-soft);
	}
	h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
	}
	header .muted {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.x {
		color: var(--text-faint);
		padding: 2px 6px;
	}
	.tabs {
		display: flex;
		gap: 4px;
		padding: 8px 12px 0;
		border-bottom: 1px solid var(--border-soft);
	}
	.tabs button {
		padding: 6px 12px 8px;
		font-size: 13px;
		color: var(--text-muted);
		border-bottom: 2px solid transparent;
	}
	.tabs button:hover {
		color: var(--text);
	}
	.tabs button.sel {
		color: var(--text);
		border-bottom-color: var(--accent);
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px;
	}
	.tools {
		padding: 0 2px 10px;
	}
	.tools input {
		width: 100%;
		padding: 7px 10px;
		background: var(--bg-sunken);
		border: 1px solid var(--border-soft);
		border-radius: 7px;
		font-size: 13px;
		color: var(--text);
		outline: none;
	}
	.card {
		margin-bottom: 10px;
		padding: 11px 13px;
		border: 1px solid var(--border-soft);
		border-radius: 10px;
	}
	.card.flow {
		border-color: var(--accent);
	}
	.card-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.name {
		flex: 1;
		min-width: 0;
		font-size: 13.5px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pill {
		flex: 0 0 auto;
		padding: 1px 8px;
		border: 1px solid var(--border-soft);
		border-radius: 20px;
		font-size: 11px;
		color: var(--text-faint);
	}
	.pill.on {
		color: var(--text);
		border-color: var(--border);
	}
	.desc {
		margin: 4px 0 0;
	}
	.var {
		margin-top: 9px;
		padding-top: 9px;
		border-top: 1px solid var(--border-soft);
	}
	.var-head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
	}
	.spacer {
		flex: 1;
	}
	.redacted {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 12px;
		color: var(--text-muted);
	}
	.editor {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}
	.editor input {
		flex: 1;
		min-width: 180px;
		padding: 6px 9px;
		background: var(--bg-sunken);
		border: 1px solid var(--border-soft);
		border-radius: 7px;
		font-size: 13px;
		color: var(--text);
		outline: none;
	}
	.editor select {
		flex: 1;
		min-width: 150px;
		padding: 6px 9px;
		background: var(--bg-sunken);
		border: 1px solid var(--border-soft);
		border-radius: 7px;
		font-size: 13px;
		color: var(--text);
		outline: none;
	}
	.actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 9px;
	}
	.warn {
		margin-top: 10px;
		padding: 9px 11px;
		border: 1px solid var(--danger);
		border-radius: 8px;
	}
	.warn p {
		margin: 0;
		font-size: 13px;
	}
	button {
		padding: 5px 11px;
		border: 1px solid var(--border);
		border-radius: 7px;
		font-size: 12.5px;
	}
	.tabs button,
	.x {
		border: none;
		border-radius: 0;
	}
	button:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	button.primary:not(:disabled) {
		background: var(--bg-sunken);
		font-weight: 600;
	}
	button.danger {
		color: var(--danger);
		border-color: var(--danger);
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.unavailable {
		padding: 26px 20px;
		text-align: center;
	}
	.unavailable p {
		margin: 0 auto 8px;
		max-width: 480px;
	}
	.code {
		margin: 8px 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 22px;
		letter-spacing: 0.16em;
		text-align: center;
	}
	.ok {
		color: var(--text);
	}
	.ko {
		color: var(--danger);
	}
	p {
		font-size: 13px;
	}
	.muted {
		color: var(--text-muted);
	}
	.small {
		font-size: 12px;
	}
	.none {
		padding: 24px;
		text-align: center;
		color: var(--text-faint);
		font-size: 13px;
	}
	code {
		padding: 1px 5px;
		background: var(--bg-sunken);
		border-radius: 4px;
		font-size: 11.5px;
	}
	a {
		color: var(--text);
	}
</style>
