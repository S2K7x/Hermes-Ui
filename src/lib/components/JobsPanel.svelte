<script lang="ts">
	import { jobsStore } from '$lib/stores/jobs.svelte';
	import {
		MAX_JOB_NAME,
		MAX_JOB_PROMPT,
		SCHEDULE_PRESETS,
		deliveryHint,
		jobState,
		nextRunLabel,
		parseSchedule,
		scheduleDisplay,
		targetLabel
	} from '$lib/jobs';
	import type { HermesJob } from '$lib/types';

	interface Props {
		open: boolean;
		onclose: () => void;
	}
	let { open, onclose }: Props = $props();

	let creating = $state(false);
	let name = $state('');
	let schedule = $state('');
	let prompt = $state('');
	let deliver = $state('local');

	// Load once per session, on first open — a Pi has better things to do than
	// poll a job list nobody is looking at.
	$effect(() => {
		if (open && jobsStore.jobs === null) jobsStore.refresh();
	});

	// Re-evaluated on every keystroke so the preview follows what is typed. The
	// clock is read here rather than inside parseSchedule's default so "dans
	// 30 min" stays honest while the form sits open.
	let parsed = $derived(parseSchedule(schedule, new Date()));
	let canCreate = $derived(
		!jobsStore.creating &&
			name.trim().length > 0 &&
			name.trim().length <= MAX_JOB_NAME &&
			prompt.trim().length > 0 &&
			prompt.trim().length <= MAX_JOB_PROMPT &&
			parsed.kind !== null
	);

	function startCreate() {
		creating = true;
		name = '';
		schedule = '';
		prompt = '';
		deliver = jobsStore.deliveryChoices[0]?.id ?? 'local';
	}

	async function submit() {
		if (!canCreate) return;
		const ok = await jobsStore.create({
			name: name.trim(),
			schedule: schedule.trim(),
			prompt: prompt.trim(),
			deliver
		});
		if (ok) creating = false;
	}

	/**
	 * State, next run and destination as one string.
	 *
	 * Built here rather than inline in the markup: Svelte trims the leading
	 * whitespace of a text node that starts a block, which silently glued
	 * "Programmée" to "· prochaine …".
	 */
	function metaLine(job: HermesJob): string {
		const state = jobState(job);
		const parts = [state.label];
		const next = nextRunLabel(job);
		if (next && state.key !== 'paused') parts.push(`prochaine ${next}`);
		if (job.deliver && job.deliver !== 'local') parts.push(`envoyé sur ${job.deliver}`);
		return parts.join(' · ');
	}

	function confirmRemove(id: string, label: string) {
		if (!confirm(`Supprimer définitivement la tâche « ${label} » ?`)) return;
		jobsStore.remove(id);
	}

	function onKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			if (creating) creating = false;
			else onclose();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="scrim" onclick={onclose}></div>
	<div class="panel" role="dialog" aria-modal="true" aria-label="Tâches planifiées">
		<header>
			<h2>Tâches planifiées</h2>
			<span class="muted small">Hermes les exécute seul, même app fermée</span>
			<button class="x" onclick={onclose} aria-label="Fermer">✕</button>
		</header>

		<div class="body">
			{#if jobsStore.unavailable}
				<p class="none">
					Ce Hermes tourne sans son module cron : aucune tâche ne peut être planifiée.
				</p>
			{:else}
				{#if creating}
					<div class="form">
						<label>
							Nom
							<input bind:value={name} placeholder="Résumé de la veille" maxlength={MAX_JOB_NAME} />
						</label>

						<label>
							Quand
							<input
								bind:value={schedule}
								placeholder="0 8 * * *"
								autocapitalize="off"
								autocorrect="off"
								spellcheck="false"
							/>
						</label>
						<div class="presets">
							{#each SCHEDULE_PRESETS as preset (preset.value)}
								<button
									type="button"
									class:sel={schedule.trim() === preset.value}
									onclick={() => (schedule = preset.value)}>{preset.label}</button
								>
							{/each}
						</div>
						{#if schedule.trim()}
							<p class="preview" class:bad={parsed.kind === null}>
								{parsed.kind === null ? parsed.error : `Tournera ${parsed.display}.`}
							</p>
						{/if}

						<label>
							Instruction pour Hermes
							<textarea
								bind:value={prompt}
								rows="4"
								maxlength={MAX_JOB_PROMPT}
								placeholder="Résume les nouveautés tech du jour en cinq puces."
							></textarea>
						</label>
						<p class="muted small">
							L'instruction doit se suffire à elle-même : la tâche tourne dans sa propre
							conversation, sans le contexte de celle-ci.
						</p>

						{#if jobsStore.deliveryChoices.length > 1}
							<label>
								Livraison
								<select bind:value={deliver}>
									{#each jobsStore.deliveryChoices as target (target.id)}
										<option value={target.id}>{targetLabel(target)}</option>
									{/each}
								</select>
							</label>
						{/if}
						<p class="muted small">{deliveryHint(deliver)}</p>

						<div class="actions">
							<button onclick={() => (creating = false)}>Annuler</button>
							<button class="primary" disabled={!canCreate} onclick={submit}>
								{jobsStore.creating ? 'Création…' : 'Planifier'}
							</button>
						</div>
					</div>
				{:else}
					<button class="new" onclick={startCreate}>＋ Nouvelle tâche</button>

					{#if jobsStore.jobs === null && jobsStore.loading}
						<p class="none">Chargement…</p>
					{:else if jobsStore.sorted.length === 0}
						<p class="none">
							Aucune tâche planifiée. Un rappel dans deux heures ou un résumé chaque matin, c'est
							ici.
						</p>
					{/if}

					<ul class="jobs">
						{#each jobsStore.sorted as job (job.id)}
							{@const state = jobState(job)}
							<li class:paused={state.key === 'paused'}>
								<div class="row">
									<span class="icon" title={state.label}>{state.icon}</span>
									<span class="title">{job.name}</span>
									<span class="when">{scheduleDisplay(job)}</span>
								</div>
								{#if job.prompt}
									<p class="prompt">{job.prompt}</p>
								{/if}
								<div class="meta">
									<span class="muted small">{metaLine(job)}</span>
								</div>
								{#if job.last_error}
									<p class="err">{job.last_error}</p>
								{/if}
								<div class="ops">
									<button
										disabled={jobsStore.busyId === job.id}
										onclick={() => jobsStore.act(job.id!, 'run')}>Lancer</button
									>
									<button
										disabled={jobsStore.busyId === job.id}
										onclick={() => jobsStore.act(job.id!, state.key === 'paused' ? 'resume' : 'pause')}
									>
										{state.key === 'paused' ? 'Reprendre' : 'Mettre en pause'}
									</button>
									<button
										class="danger"
										disabled={jobsStore.busyId === job.id}
										onclick={() => confirmRemove(job.id!, job.name ?? job.id!)}>Supprimer</button
									>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</div>

		<footer>
			<span class="muted small">
				{#if !jobsStore.unavailable && !creating}
					Une tâche tourne côté Pi avec tous les outils de Hermes.
				{/if}
			</span>
			<button onclick={() => jobsStore.refresh()} disabled={jobsStore.loading}>Actualiser</button>
		</footer>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 150;
		background: var(--scrim);
	}
	.panel {
		position: fixed;
		z-index: 151;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(620px, calc(100vw - 20px));
		max-height: min(86vh, calc(100dvh - 20px));
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		box-shadow: var(--shadow);
		overflow: hidden;
	}
	header,
	footer {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 16px;
	}
	header {
		align-items: baseline;
		border-bottom: 1px solid var(--border-soft);
	}
	footer {
		border-top: 1px solid var(--border-soft);
	}
	footer .muted {
		flex: 1;
		min-width: 0;
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
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 16px;
	}
	.new {
		width: 100%;
		padding: 9px 12px;
		border: 1px dashed var(--border);
		border-radius: 9px;
		font-size: 13.5px;
		color: var(--text-muted);
	}
	.new:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.jobs {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.jobs li {
		padding: 10px 12px;
		border: 1px solid var(--border-soft);
		border-radius: 10px;
		background: var(--bg-sunken);
	}
	.jobs li.paused {
		opacity: 0.68;
	}
	.row {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.icon {
		flex: 0 0 auto;
	}
	.title {
		flex: 1;
		min-width: 0;
		font-size: 13.5px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.when {
		flex: 0 0 auto;
		font-size: 11.5px;
		color: var(--text-faint);
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	}
	.prompt {
		margin: 5px 0 0;
		font-size: 12.5px;
		color: var(--text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.meta {
		margin-top: 5px;
	}
	.err {
		margin: 6px 0 0;
		font-size: 12px;
		color: var(--danger);
		overflow-wrap: anywhere;
	}
	.ops {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 9px;
	}
	.ops button,
	.actions button,
	footer button {
		padding: 5px 11px;
		border: 1px solid var(--border);
		border-radius: 7px;
		font-size: 12.5px;
	}
	.ops button:hover:not(:disabled),
	.actions button:hover:not(:disabled),
	footer button:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.danger:not(:disabled) {
		color: var(--danger);
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	button.primary:not(:disabled) {
		background: var(--bg-sunken);
		font-weight: 600;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.form label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12.5px;
		color: var(--text-muted);
	}
	.form input,
	.form textarea,
	.form select {
		padding: 7px 10px;
		background: var(--bg-sunken);
		border: 1px solid var(--border-soft);
		border-radius: 7px;
		font-size: 13.5px;
		font-family: inherit;
		color: var(--text);
		outline: none;
	}
	.form textarea {
		resize: vertical;
		line-height: 1.5;
	}
	.form input:focus,
	.form textarea:focus,
	.form select:focus {
		border-color: var(--border);
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: -4px;
	}
	.presets button {
		padding: 4px 10px;
		border: 1px solid var(--border-soft);
		border-radius: 20px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.presets button:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.presets button.sel {
		border-color: var(--accent);
		color: var(--text);
	}
	.preview {
		margin: 0;
		font-size: 12.5px;
		color: var(--text-muted);
	}
	.preview.bad {
		color: var(--danger);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.muted {
		color: var(--text-muted);
	}
	.small {
		font-size: 12px;
	}
	.form p.muted {
		margin: -4px 0 0;
	}
	.none {
		padding: 26px 10px;
		text-align: center;
		color: var(--text-faint);
		font-size: 13px;
	}

	/* Phone: come up from the bottom edge instead of floating in the middle,
	   rounded on top only. Margins on a 390px screen are lost width. */
	@media (max-width: 820px) {
		.panel {
			top: auto;
			bottom: 0;
			left: 0;
			transform: none;
			width: 100%;
			max-height: 92dvh;
			border-radius: var(--radius-panel) var(--radius-panel) 0 0;
			border-bottom: none;
			padding-bottom: env(safe-area-inset-bottom);
		}
	}
</style>
