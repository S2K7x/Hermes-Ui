<script lang="ts">
	import { chat } from '$lib/stores/chat.svelte';
	import { activityAt, matchesQuery, relativeTime, sessionLabel } from '$lib/sessions';

	interface Command {
		id: string;
		label: string;
		hint?: string;
		run: () => void;
	}

	interface Props {
		open: boolean;
		onclose: () => void;
		commands: Command[];
	}
	let { open, onclose, commands }: Props = $props();

	let query = $state('');
	let index = $state(0);
	let input = $state<HTMLInputElement | null>(null);

	interface Row {
		key: string;
		kind: 'command' | 'session';
		label: string;
		hint?: string;
		run: () => void;
	}

	let matchedCommands = $derived(
		commands
			.filter((c) => !query || c.label.toLowerCase().includes(query.toLowerCase()))
			.map<Row>((c) => ({ key: `c:${c.id}`, kind: 'command', label: c.label, hint: c.hint, run: c.run }))
	);

	let matchedSessions = $derived(
		chat.sessions
			.filter((s) => !s.archived && matchesQuery(s, query))
			.slice(0, 12)
			.map<Row>((s) => ({
				key: `s:${s.id}`,
				kind: 'session',
				label: sessionLabel(s),
				hint: relativeTime(activityAt(s)),
				run: () => chat.openSession(s.id)
			}))
	);

	let rows = $derived([...matchedCommands, ...matchedSessions]);

	// Reset on each open, and keep the highlight inside the result list as it
	// shrinks under typing.
	$effect(() => {
		if (open) {
			query = '';
			index = 0;
			queueMicrotask(() => input?.focus());
		}
	});
	$effect(() => {
		if (index >= rows.length) index = Math.max(0, rows.length - 1);
	});

	function choose(row: Row | undefined) {
		if (!row) return;
		onclose();
		row.run();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			index = rows.length ? (index + 1) % rows.length : 0;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			index = rows.length ? (index - 1 + rows.length) % rows.length : 0;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			choose(rows[index]);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="scrim" onclick={onclose}></div>
	<div class="palette" role="dialog" aria-modal="true" aria-label="Palette de commandes">
		<input
			bind:this={input}
			bind:value={query}
			onkeydown={onKeydown}
			placeholder="Rechercher une conversation ou une action…"
			aria-label="Recherche"
		/>
		<div class="rows">
			{#each rows as row, i (row.key)}
				<button
					class:sel={i === index}
					onclick={() => choose(row)}
					onmouseenter={() => (index = i)}
				>
					<span class="kind">{row.kind === 'command' ? '⌘' : '💬'}</span>
					<span class="label">{row.label}</span>
					{#if row.hint}<span class="hint">{row.hint}</span>{/if}
				</button>
			{/each}
			{#if rows.length === 0}
				<p class="none">Aucun résultat.</p>
			{/if}
		</div>
		<div class="foot">
			<kbd>↑</kbd><kbd>↓</kbd> naviguer · <kbd>↵</kbd> ouvrir · <kbd>esc</kbd> fermer
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 150;
		background: var(--scrim);
	}
	.palette {
		position: fixed;
		z-index: 151;
		top: 12vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(560px, calc(100vw - 24px));
		max-height: 70vh;
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		box-shadow: var(--shadow);
		overflow: hidden;
	}
	input {
		padding: 14px 16px;
		background: none;
		border: none;
		border-bottom: 1px solid var(--border-soft);
		font-size: 15px;
		outline: none;
	}
	.rows {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
	}
	.rows button {
		display: flex;
		align-items: baseline;
		gap: 10px;
		width: 100%;
		padding: 8px 10px;
		border-radius: 8px;
		text-align: left;
	}
	.rows button.sel {
		background: var(--bg-hover);
	}
	.kind {
		flex: 0 0 auto;
		font-size: 12px;
		color: var(--text-faint);
	}
	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 14px;
	}
	.hint {
		flex: 0 0 auto;
		font-size: 11.5px;
		color: var(--text-faint);
	}
	.none {
		padding: 18px;
		text-align: center;
		color: var(--text-faint);
		font-size: 13px;
	}
	.foot {
		padding: 7px 14px;
		border-top: 1px solid var(--border-soft);
		font-size: 11px;
		color: var(--text-faint);
	}
	kbd {
		display: inline-block;
		padding: 1px 5px;
		margin: 0 1px;
		font-family: inherit;
		font-size: 10.5px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-sunken);
	}

	/* Phone: full width, but still anchored near the top — this panel's first
	   element is a text field, and a sheet rising from the bottom would put it
	   exactly where the keyboard lands. */
	@media (max-width: 820px) {
		.palette {
			top: max(8px, env(safe-area-inset-top));
			left: 0;
			transform: none;
			width: 100%;
			max-height: 60dvh;
			border-radius: var(--radius-panel);
		}
	}
</style>
