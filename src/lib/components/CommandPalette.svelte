<script lang="ts">
	import Icon from './Icon.svelte';
	import { chat } from '$lib/stores/chat.svelte';
	import { activityAt, matchesQuery, relativeTime, sessionLabel } from '$lib/sessions';
	import { findInMessages } from '$lib/search';

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
		/** Scroll the thread to one of its messages, and flash it. */
		onjump?: (messageId: string) => void;
	}
	let { open, onclose, commands, onjump }: Props = $props();

	let query = $state('');
	let index = $state(0);
	let input = $state<HTMLInputElement | null>(null);

	interface Row {
		key: string;
		kind: 'command' | 'session' | 'message';
		label: string;
		hint?: string;
		/** Heading printed above this row, when it opens a group. */
		head?: string;
		/** A message excerpt, split so the match can be marked. */
		snippet?: { before: string; match: string; after: string };
		run: () => void;
	}

	let matchedCommands = $derived(
		commands
			.filter((c) => !query || c.label.toLowerCase().includes(query.toLowerCase()))
			.map<Row>((c) => ({ key: `c:${c.id}`, kind: 'command', label: c.label, hint: c.hint, run: c.run }))
	);

	/**
	 * Passages of the open conversation.
	 *
	 * The transcript is already in the browser, so this costs no round trip —
	 * and it is the only way to find a passage at all on a phone, where an
	 * installed PWA has no find-in-page.
	 *
	 * Listed last, under the conversations. Almost any query matches somewhere
	 * in a long thread, so putting these first would push the conversation the
	 * user was reaching for off the panel — the palette's oldest job.
	 *
	 * Gated on `open`, because the row list is read by an effect below: without
	 * that guard, a palette merely closed on a leftover query would refold the
	 * whole transcript on every token of the turn streaming behind it.
	 */
	let matchedMessages = $derived(
		open && onjump
			? findInMessages(chat.messages, query).map<Row>((hit) => ({
					key: `m:${hit.id}`,
					kind: 'message',
					label: `${hit.before}${hit.match}${hit.after}`,
					hint: `${hit.role === 'user' ? 'Vous' : 'Yadai'}${hit.count > 1 ? ` · ${hit.count}×` : ''}`,
					snippet: { before: hit.before, match: hit.match, after: hit.after },
					run: () => onjump?.(hit.id)
				}))
			: []
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

	const HEADS: Record<Row['kind'], string> = {
		command: 'Actions',
		message: 'Dans cette conversation',
		session: 'Conversations'
	};

	// A heading is carried by the first row of each group, so the rendered list
	// stays one flat array and the arrow keys keep their arithmetic.
	let rows = $derived(
		[...matchedCommands, ...matchedSessions, ...matchedMessages].map((row, i, all) =>
			i === 0 || all[i - 1].kind !== row.kind ? { ...row, head: HEADS[row.kind] } : row
		)
	);

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
			placeholder="Rechercher un message, une conversation, une action…"
			aria-label="Recherche"
		/>
		<div class="rows">
			{#each rows as row, i (row.key)}
				{#if row.head}<p class="group">{row.head}</p>{/if}
				<button
					class:sel={i === index}
					onclick={() => choose(row)}
					onmouseenter={() => (index = i)}
				>
					<span class="kind" aria-hidden="true">
						<Icon
							name={row.kind === 'command' ? 'command' : row.kind === 'message' ? 'search' : 'message'}
							size={15}
						/>
					</span>
					{#if row.snippet}
						<span class="label"
							>{row.snippet.before}<mark>{row.snippet.match}</mark>{row.snippet.after}</span
						>
					{:else}
						<span class="label">{row.label}</span>
					{/if}
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
		border-radius: var(--radius-panel);
		box-shadow: var(--shadow-float);
		overflow: hidden;
	}
	input {
		margin: 10px 10px 4px;
		padding: 13px 16px;
		background: var(--bg-sunken);
		border: none;
		border-radius: var(--radius-pill);
		font-size: 15px;
	}
	.rows {
		flex: 1;
		overflow-y: auto;
		padding: 6px 10px 10px;
	}
	.rows button {
		display: flex;
		align-items: baseline;
		gap: 10px;
		width: 100%;
		padding: 10px 13px;
		border-radius: var(--radius-card);
		text-align: left;
	}
	.rows button.sel {
		background: var(--bg-hover);
	}
	.group {
		margin: 8px 0 2px;
		padding: 0 10px;
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
	}
	.rows > .group:first-child {
		margin-top: 2px;
	}
	mark {
		background: var(--accent-soft);
		color: var(--text);
		border-radius: 3px;
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
		padding: 4px 18px 14px;
		font-size: 11px;
		color: var(--text-faint);
	}
	kbd {
		display: inline-block;
		padding: 1px 5px;
		margin: 0 1px;
		font-family: inherit;
		font-size: 10.5px;
		border-radius: 5px;
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
