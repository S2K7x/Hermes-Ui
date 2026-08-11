<script lang="ts">
	import PushSettings from './PushSettings.svelte';
	import { chat } from '$lib/stores/chat.svelte';
	import { usageSummary } from '$lib/sessions';
	import { jobState, nextRunLabel, scheduleDisplay, sortJobs } from '$lib/jobs';
	import type { HermesJob } from '$lib/types';

	interface Props {
		open: boolean;
		onclose: () => void;
		onopenJobs: () => void;
	}
	let { open, onclose, onopenJobs }: Props = $props();

	let jobs = $derived(sortJobs(chat.status?.jobs ?? []));

	/**
	 * Schedule plus next run, as one string.
	 *
	 * `job.schedule` is an object upstream, so it can never be printed
	 * directly; and building this inline would let Svelte trim the leading
	 * space of the conditional half and glue the two together.
	 */
	function jobLine(job: HermesJob): string {
		const next = jobState(job).key === 'paused' ? '' : nextRunLabel(job);
		return next ? `${scheduleDisplay(job)} · ${next}` : scheduleDisplay(job);
	}

	// Refresh on open only: /health/detailed stats the disk and reads the
	// gateway runtime file, which is not something to poll on a Pi.
	$effect(() => {
		if (open) chat.refreshStatus();
	});

	let health = $derived(chat.status?.health ?? null);
	let checks = $derived(Object.entries(health?.readiness?.checks ?? {}));

	function icon(status: string): string {
		if (status === 'ok') return '🟢';
		if (status === 'warn' || status === 'degraded') return '🟡';
		return '🔴';
	}

	const LABELS: Record<string, string> = {
		state_db: 'Base de données',
		config: 'Configuration',
		model: 'Modèle',
		disk: 'Disque',
		gateway: 'Gateway',
		background_queues: "Files d'arrière-plan"
	};

	/** Pull the interesting numbers out of a readiness check for display. */
	function detail(name: string, check: Record<string, unknown>): string {
		if (name === 'disk') {
			const used = check.used_percent as number | undefined;
			const free = check.free_bytes as number | undefined;
			const gb = free ? (free / 1024 ** 3).toFixed(0) : null;
			return [used !== undefined ? `${used}% utilisé` : null, gb ? `${gb} Go libres` : null]
				.filter(Boolean)
				.join(' · ');
		}
		if (name === 'gateway') {
			return `${check.state ?? '?'} · ${check.connected_platforms ?? 0}/${check.platforms ?? 0} plateformes`;
		}
		if (name === 'background_queues') {
			return `${check.active_api_runs ?? 0} run(s) API · ${check.active_delegations ?? 0} délégation(s)`;
		}
		return '';
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="scrim" onclick={onclose}></div>
	<div class="panel" role="dialog" aria-modal="true" aria-label="État du système">
		<header>
			<h2>État du système</h2>
			<button class="x" onclick={onclose} aria-label="Fermer">✕</button>
		</header>

		<div class="body">
			{#if chat.status === null}
				<p class="muted">Chargement…</p>
			{:else if chat.status.healthError}
				<p class="err">⚠️ {chat.status.healthError}</p>
			{/if}

			{#if health}
				<div class="hero">
					<span class="big">{icon(health.readiness?.status ?? health.status)}</span>
					<div>
						<div class="strong">Hermes {health.version}</div>
						<div class="muted">
							gateway {health.gateway_state ?? '?'} · PID {health.pid}
							{#if health.gateway_busy}· occupé{/if}
						</div>
					</div>
				</div>

				<h3>Contrôles</h3>
				<ul class="checks">
					{#each checks as [name, check] (name)}
						<li>
							<span>{icon(String(check.status))}</span>
							<span class="name">{LABELS[name] ?? name}</span>
							<span class="muted small">{detail(name, check)}</span>
						</li>
					{/each}
				</ul>

				<h3>Plateformes</h3>
				<ul class="checks">
					{#each Object.entries(health.platforms ?? {}) as [name, info] (name)}
						<li>
							<span>{info.state === 'connected' ? '🟢' : '🔴'}</span>
							<span class="name">{name}</span>
							<span class="muted small">{info.state ?? '?'}{info.error_code ? ` · ${info.error_code}` : ''}</span>
						</li>
					{/each}
				</ul>
			{/if}

			<h3>Cette interface</h3>
			<ul class="checks">
				<li>
					<span>⚙️</span>
					<span class="name">Tours simultanés</span>
					<span class="muted small">
						{chat.status?.turns.active ?? 0} / {chat.status?.turns.limit ?? '—'}
					</span>
				</li>
				<li>
					<span>🛠️</span>
					<span class="name">Outils exposés</span>
					<span class="muted small">
						{chat.toolCount}{chat.mcpTools.length ? ` · dont ${chat.mcpTools.length} MCP` : ''}
					</span>
				</li>
				<li>
					<span>📚</span>
					<span class="name">Skills</span>
					<span class="muted small">{chat.skills.length}</span>
				</li>
				{#if usageSummary(chat.current)}
					<li>
						<span>📊</span>
						<span class="name">Conversation ouverte</span>
						<span class="muted small">{usageSummary(chat.current)}</span>
					</li>
				{/if}
			</ul>

			<PushSettings />

			{#if chat.status?.jobsAvailable}
				<h3>
					Tâches planifiées
					<button class="link" onclick={onopenJobs}>gérer</button>
				</h3>
				{#if jobs.length === 0}
					<p class="muted small empty">Aucune tâche planifiée.</p>
				{:else}
					<ul class="checks">
						{#each jobs as job (job.id ?? job.name)}
							{@const state = jobState(job)}
							<li>
								<span title={state.label}>{state.icon}</span>
								<span class="name">{job.name ?? job.id}</span>
								<span class="muted small">{jobLine(job)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}

			{#if chat.mcpTools.length}
				<h3>Outils MCP</h3>
				<p class="tools">
					{#each chat.mcpTools as tool (tool)}<code>{tool}</code>{/each}
				</p>
			{/if}
		</div>

		<footer>
			<button onclick={() => chat.refreshStatus()}>Actualiser</button>
		</footer>
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
		width: min(560px, calc(100vw - 24px));
		max-height: 84vh;
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
	h3 {
		margin: 18px 0 6px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
	h3:first-of-type {
		margin-top: 14px;
	}
	h3 .link {
		margin-left: 8px;
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0;
		text-transform: none;
		color: var(--text-muted);
		text-decoration: underline;
	}
	h3 .link:hover {
		color: var(--text);
	}
	.empty {
		margin: 0;
	}
	.x {
		color: var(--text-faint);
		padding: 2px 6px;
	}
	.body {
		flex: 1;
		overflow-y: auto;
		padding: 4px 16px 16px;
	}
	.hero {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 0 2px;
	}
	.big {
		font-size: 22px;
	}
	.strong {
		font-weight: 600;
	}
	.muted {
		color: var(--text-muted);
	}
	.small {
		font-size: 12px;
	}
	.err {
		padding: 8px 11px;
		border-radius: 8px;
		background: rgba(224, 82, 82, 0.1);
		color: var(--danger);
		font-size: 13px;
	}
	.checks {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.checks li {
		display: flex;
		align-items: baseline;
		gap: 9px;
		padding: 5px 8px;
		border-radius: 7px;
		font-size: 13.5px;
	}
	.checks li:nth-child(odd) {
		background: var(--bg-sunken);
	}
	.name {
		flex: 1;
		min-width: 0;
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin: 0;
	}
	.tools code {
		padding: 2px 7px;
		font-size: 11.5px;
		background: var(--bg-sunken);
		border-radius: 5px;
		color: var(--text-muted);
	}
	footer {
		padding: 10px 16px;
		border-top: 1px solid var(--border-soft);
		text-align: right;
	}
	footer button {
		padding: 5px 12px;
		border: 1px solid var(--border);
		border-radius: 7px;
		font-size: 13px;
	}
	footer button:hover {
		background: var(--bg-hover);
	}
</style>
