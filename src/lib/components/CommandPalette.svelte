<script lang="ts">
	import Icon from './Icon.svelte';
	import { groupOptions, menuIndex } from '$lib/a11y';
	import { trapTab } from '$lib/client/dialog.svelte';
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
	let card = $state<HTMLElement | null>(null);
	let list = $state<HTMLElement | null>(null);

	/** Prefix of each option's id, which `aria-activedescendant` points at. */
	const OPTION_ID = 'palette-option-';

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

	// The same rows, nested under their heading — the only shape a listbox may
	// take. The flat `rows` array stays the source of the arrow arithmetic;
	// `groupOptions` is only how it is drawn, and it carries each flat index
	// along so the cursor and the click cannot disagree.
	let groups = $derived(groupOptions(rows));

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

	/**
	 * Keep the cursor on screen.
	 *
	 * The result list scrolls — twelve conversations and every matching passage
	 * of a long thread go well past the panel's 70vh. The highlight did not
	 * follow it: pressing Down a dozen times moved a marker nobody could see,
	 * and Enter then opened something that was never on screen. Nothing else
	 * reported it, because the panel looked perfectly still.
	 */
	$effect(() => {
		void rows.length;
		const i = index;
		if (!open || !list) return;
		list.querySelector<HTMLElement>(`#${OPTION_ID}${i}`)?.scrollIntoView({ block: 'nearest' });
	});

	function choose(row: Row | undefined) {
		if (!row) return;
		onclose();
		row.run();
	}

	function onKeydown(event: KeyboardEvent) {
		// The wrap-around arithmetic is `menuIndex`, the same one the popup
		// menus use — but only for the two arrows. This is an editable
		// combobox: Home and End belong to the text field, and stealing them
		// would stop the caret from jumping to either end of the query.
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			const next = menuIndex(rows.length, index, event.key);
			if (next === null) return;
			event.preventDefault();
			index = next;
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
	<!-- Tab must not walk out of a panel that calls itself modal: the rows are
	     options a script moves a cursor through, not stops of their own, so the
	     field is the only place Tab can land. Closing deliberately leaves the
	     focus alone — choosing a saved prompt puts it in the composer, and
	     restoring it here would pull it straight back out. -->
	<div
		class="palette"
		bind:this={card}
		onkeydown={(event) => card && trapTab(card, event)}
		role="dialog"
		aria-modal="true"
		aria-label="Palette de commandes"
		tabindex="-1"
	>
		<input
			bind:this={input}
			bind:value={query}
			onkeydown={onKeydown}
			placeholder="Rechercher un message, une conversation, une action…"
			aria-label="Recherche"
			role="combobox"
			aria-controls="palette-results"
			aria-expanded={rows.length > 0}
			aria-autocomplete="list"
			aria-activedescendant={rows[index] ? `${OPTION_ID}${index}` : undefined}
		/>
		<div
			class="rows"
			bind:this={list}
			id="palette-results"
			role="listbox"
			aria-label="Résultats"
		>
			{#each groups as group (group.head)}
				<div role="group" aria-label={group.head}>
					<p class="group" aria-hidden="true">{group.head}</p>
					{#each group.items as { option: row, index: i } (row.key)}
						<button
							id="{OPTION_ID}{i}"
							role="option"
							aria-selected={i === index}
							tabindex="-1"
							class:sel={i === index}
							onclick={() => choose(row)}
							onmouseenter={() => (index = i)}
						>
							<span class="kind" aria-hidden="true">
								<Icon
									name={row.kind === 'command'
										? 'command'
										: row.kind === 'message'
											? 'search'
											: 'message'}
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
				</div>
			{/each}
		</div>
		{#if rows.length === 0}
			<!-- Outside the listbox, which may hold nothing but options: an empty
			     result is the one state the cursor cannot announce by itself. -->
			<p class="none" role="status">Aucun résultat.</p>
		{/if}
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
	.rows > [role='group']:first-child > .group {
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
		/* Same 44px floor as the sidebar rows and the popup menus: this list is
		   reached by a thumb too, and its rows sat at 40. */
		.rows button {
			min-height: 44px;
		}
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
