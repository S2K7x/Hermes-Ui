<script lang="ts">
	import { toolIcon, toolLabel } from '$lib/transcript';
	import type { ToolStep } from '$lib/types';

	interface Props {
		steps: ToolStep[];
		reasoning?: string;
		streaming?: boolean;
	}
	let { steps, reasoning = '', streaming = false }: Props = $props();

	// Auto-open while the agent is working so you can watch it; collapse on
	// its own once the answer lands, like Claude's thinking blocks.
	let manual = $state<boolean | null>(null);
	let open = $derived(manual ?? streaming);

	let running = $derived(steps.filter((s) => s.status === 'running').length);
	let summary = $derived(
		running > 0
			? `${toolIcon(steps.at(-1)?.tool_name ?? '')} ${toolLabel(steps.at(-1)?.tool_name ?? 'travail en cours')}…`
			: `${steps.length} étape${steps.length > 1 ? 's' : ''}`
	);

	function argPreview(step: ToolStep): string {
		const raw = step.preview ?? step.args;
		if (raw == null) return '';
		const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
		return text.length > 220 ? `${text.slice(0, 220)}…` : text;
	}
</script>

{#if steps.length || reasoning}
	<div class="timeline" class:active={running > 0}>
		<button class="head" onclick={() => (manual = !open)} aria-expanded={open}>
			<span class="chev" class:open>›</span>
			<span class="sum">{summary}</span>
			{#if running > 0}<span class="pulse"></span>{/if}
		</button>

		{#if open}
			<div class="body">
				{#if reasoning}
					<div class="reasoning">
						<span class="icon">💭</span>
						<div class="reasoning-text">{reasoning}</div>
					</div>
				{/if}
				{#each steps as step (step.key)}
					<div class="step" class:failed={step.status === 'failed'}>
						<span class="icon">{toolIcon(step.tool_name)}</span>
						<div class="detail">
							<div class="name">
								{toolLabel(step.tool_name)}
								{#if step.status === 'running'}<span class="dots">…</span>{/if}
								{#if step.status === 'failed'}<span class="badge">échec</span>{/if}
							</div>
							{#if argPreview(step)}
								<div class="args">{argPreview(step)}</div>
							{/if}
							{#if step.result && step.status !== 'running'}
								<div class="result">{step.result.slice(0, 600)}</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.timeline {
		margin: 0 0 10px;
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-card);
		background: var(--bg-sunken);
		font-size: 13px;
	}
	.timeline.active {
		border-color: var(--accent-soft);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 11px;
		color: var(--text-muted);
		text-align: left;
	}
	.chev {
		display: inline-block;
		transition: transform 0.15s;
		font-size: 15px;
		line-height: 1;
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.sum {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pulse {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
		animation: pulse 1.1s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 0.25;
		}
		50% {
			opacity: 1;
		}
	}
	.body {
		padding: 2px 11px 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.step,
	.reasoning {
		display: flex;
		gap: 9px;
		align-items: flex-start;
	}
	.icon {
		flex: 0 0 auto;
		line-height: 1.5;
	}
	.detail {
		min-width: 0;
		flex: 1;
	}
	.name {
		font-weight: 500;
		color: var(--text);
	}
	.badge {
		margin-left: 6px;
		padding: 0 6px;
		font-size: 11px;
		border-radius: 4px;
		background: var(--danger-soft);
		color: var(--danger);
	}
	.step.failed .name {
		color: var(--danger);
	}
	.args,
	.result,
	.reasoning-text {
		margin-top: 2px;
		font-family: ui-monospace, Menlo, Consolas, monospace;
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--text-faint);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 9em;
		overflow: auto;
	}
	.reasoning-text {
		font-family: inherit;
		font-size: 12.5px;
		font-style: italic;
		color: var(--text-muted);
	}
	.dots {
		color: var(--accent);
	}
</style>
