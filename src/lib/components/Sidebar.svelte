<script lang="ts">
	import { dialogFocus, trapTab } from '$lib/client/dialog.svelte';
	import { chat } from '$lib/stores/chat.svelte';
	import { agents } from '$lib/stores/agents.svelte';
	import { agentColor } from '$lib/agents';
	import { groupSessions, matchesQuery, relativeTime, sessionLabel, activityAt } from '$lib/sessions';
	import type { HermesSession } from '$lib/types';

	interface Props {
		open: boolean;
		/**
		 * Under 820px the sidebar is not a column but a drawer sliding over the
		 * thread, scrim included — which makes it a modal dialog, with
		 * everything that entails for the keyboard and for VoiceOver.
		 */
		drawer: boolean;
		collapsed: boolean;
		onclose: () => void;
		ontoggleCollapse: () => void;
		onopenStatus: () => void;
		onopenSkills: () => void;
		onopenProviders: () => void;
		onopenJobs: () => void;
		onopenAgents: () => void;
		onopenTheme: () => void;
	}
	let {
		open,
		drawer,
		collapsed,
		onclose,
		ontoggleCollapse,
		onopenStatus,
		onopenSkills,
		onopenProviders,
		onopenJobs,
		onopenAgents,
		onopenTheme
	}: Props = $props();

	let panel = $state<HTMLElement | null>(null);
	/** A drawer that is out and covering the thread: a dialog, not a column. */
	let modal = $derived(drawer && open);

	// Same contract as every settings panel (point 22): focus enters the drawer
	// when it slides out, and goes back to the ☰ button when it closes.
	dialogFocus(
		() => modal,
		() => panel
	);

	let filter = $state('');
	let showArchived = $state(false);
	let renaming = $state<string | null>(null);
	let renameValue = $state('');
	let menuFor = $state<string | null>(null);

	// Archived conversations come from a different list, not a filter: Hermes
	// excludes them from every listing, so `chat.sessions` never holds one.
	let visible = $derived(
		(showArchived ? chat.archivedSessions : chat.sessions).filter((s) => matchesQuery(s, filter))
	);
	let groups = $derived(groupSessions(visible));

	/** Rebuilding the archive costs one request per candidate — load it on open. */
	async function toggleArchived() {
		showArchived = !showArchived;
		if (showArchived) await chat.refreshArchived();
	}

	async function pick(id: string) {
		await chat.openSession(id);
		onclose();
	}

	function startRename(s: HermesSession) {
		renaming = s.id;
		renameValue = s.title ?? '';
		menuFor = null;
	}

	async function commitRename() {
		const id = renaming;
		renaming = null;
		if (id && renameValue.trim()) await chat.renameSession(id, renameValue.trim());
	}

	async function confirmDelete(s: HermesSession) {
		menuFor = null;
		if (confirm(`Supprimer « ${sessionLabel(s)} » ? Cette action est définitive.`)) {
			await chat.deleteSession(s.id);
		}
	}

	// Clicking anywhere else closes an open row menu.
	function onWindowClick(event: MouseEvent) {
		if (!menuFor) return;
		if (!(event.target as HTMLElement).closest('.row')) menuFor = null;
	}

	/**
	 * Tab must not walk out of the open drawer into the thread behind it.
	 *
	 * Handled on the window rather than on the drawer itself because focus can
	 * legitimately sit on the element the browser is about to leave, and
	 * because as a column — every screen wider than 820px — the sidebar is not
	 * a dialog and must trap nothing at all.
	 *
	 * It also only acts on a Tab pressed *inside* the drawer. A settings panel
	 * opened on top has its own trap, and two traps pulling in opposite
	 * directions is worse than none: the drawer would drag the focus out of the
	 * dialog the user is actually in.
	 */
	function onWindowKeydown(event: KeyboardEvent) {
		if (!modal || !panel || !panel.contains(event.target as Node)) return;
		trapTab(panel, event);
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<!-- Closed, the drawer is still there: parked at `translateX(-100%)` off the
     left edge, but as reachable by Tab and by VoiceOver as if it were on
     screen. `inert` is what makes "off screen" mean "out of reach".

     `tabindex="-1"` is unconditional — it means "focusable by script, not by
     Tab", harmless on the desktop column, and it is what lets the open drawer
     take the focus and be announced by name. -->
<aside
	class="sidebar"
	class:open
	class:collapsed
	bind:this={panel}
	inert={drawer && !open}
	role={modal ? 'dialog' : undefined}
	aria-modal={modal ? 'true' : undefined}
	aria-label={modal ? 'Discussions' : undefined}
	tabindex="-1"
>
	{#if collapsed}
		<div class="rail">
			<button class="rail-btn" onclick={ontoggleCollapse} aria-label="Déplier les discussions"
				>»</button
			>
			<button class="rail-btn accent" onclick={() => chat.newSession()} aria-label="Nouvelle discussion"
				>＋</button
			>
			<div class="rail-spacer"></div>
			<button class="rail-btn" onclick={onopenAgents} aria-label="Équipe d'agents">👥</button>
			<button class="rail-btn" onclick={onopenJobs} aria-label="Tâches planifiées">⏰</button>
			<button class="rail-btn" onclick={onopenSkills} aria-label="Skills">📚</button>
			<button class="rail-btn" onclick={onopenProviders} aria-label="Providers">🔑</button>
			<button class="rail-btn" onclick={onopenTheme} aria-label="Apparence">◐</button>
			<button class="rail-btn" onclick={onopenStatus} aria-label="État du système">
				<span class="dot" class:ok={chat.connected === true} class:ko={chat.connected === false}
				></span>
			</button>
		</div>
	{:else}
		<div class="top">
			<button class="new" onclick={async () => { await chat.newSession(); onclose(); }}>
				<span>＋</span> Nouvelle discussion
			</button>
			<button class="icon-btn collapse" onclick={ontoggleCollapse} aria-label="Replier">«</button>
			<button class="icon-btn close" onclick={onclose} aria-label="Fermer le menu">✕</button>
		</div>

		<input
			class="search"
			bind:value={filter}
			placeholder="Rechercher…"
			type="search"
			aria-label="Rechercher une discussion"
		/>

		<nav class="list">
			{#each groups as group (group.key)}
				<div class="group">{group.label}</div>
				{#each group.sessions as entry (entry.id)}
					<div class="row" class:active={entry.id === chat.sessionId}>
						{#if renaming === entry.id}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="rename"
								bind:value={renameValue}
								autofocus
								onblur={commitRename}
								onkeydown={(e) => {
									if (e.key === 'Enter') commitRename();
									if (e.key === 'Escape') renaming = null;
								}}
							/>
						{:else}
							{@const agent = agents.byId(entry.agent_id)}
							<button class="entry" onclick={() => pick(entry.id)} title={entry.preview ?? ''}>
								<span class="title">
									{#if entry.parent_session_id}<span class="branch" title="branche">⑂</span>{/if}
									{#if agent}<span
											class="agent"
											style="--agent: {agentColor(agent)}"
											title="Agent : {agent.name}">{agent.emoji || '●'}</span
										>{/if}
									{sessionLabel(entry)}
								</span>
								<span class="when">{relativeTime(activityAt(entry))}</span>
							</button>
							<button
								class="more"
								aria-label="Actions"
								onclick={(e) => {
									e.stopPropagation();
									menuFor = menuFor === entry.id ? null : entry.id;
								}}>⋯</button
							>
						{/if}

						{#if menuFor === entry.id}
							<div class="menu">
								<button onclick={() => startRename(entry)}>Renommer</button>
								<button onclick={() => { chat.togglePin(entry.id); menuFor = null; }}>
									{entry.pinned ? 'Désépingler' : 'Épingler'}
								</button>
								<button onclick={() => { chat.forkSession(entry.id); menuFor = null; onclose(); }}>
									Brancher
								</button>
								<button onclick={() => { chat.toggleArchive(entry.id); menuFor = null; }}>
									{entry.archived ? 'Désarchiver' : 'Archiver'}
								</button>
								<button class="danger" onclick={() => confirmDelete(entry)}>Supprimer</button>
							</div>
						{/if}
					</div>
				{/each}
			{/each}

			{#if visible.length === 0}
				<p class="empty">
					{#if showArchived && chat.loadingArchived}
						Recherche des conversations archivées…
					{:else if !showArchived && chat.loadingSessions}
						Chargement…
					{:else if filter}
						Aucun résultat pour « {filter} ».
					{:else if showArchived}
						Aucune conversation archivée.
					{:else}
						Aucune discussion pour l'instant.
					{/if}
				</p>
			{:else if showArchived && chat.archivedTruncated}
				<p class="empty">
					Seules les conversations archivées les plus récentes sont listées : Hermes ne sait pas
					les énumérer, elles sont retrouvées une par une.
				</p>
			{/if}
		</nav>

		<footer>
			<button
				class="archive-toggle"
				onclick={toggleArchived}
				title="Les conversations archivées sont masquées des listes ; elles sont retrouvées à la demande."
			>
				{showArchived ? '← Discussions' : 'Archivées'}
			</button>
			<button
				class="archive-toggle"
				onclick={onopenAgents}
				title="Créer et modifier les agents, et leurs équipes"
			>
				👥 Agents
			</button>
			<button
				class="archive-toggle"
				onclick={onopenJobs}
				title="Rappels et tâches récurrentes exécutées par Hermes"
			>
				⏰ Tâches
			</button>
			<button class="archive-toggle" onclick={onopenSkills} title="Créer et modifier les skills">
				📚 Skills
			</button>
			<button
				class="archive-toggle"
				onclick={onopenProviders}
				title="Clés API, comptes OAuth et modèle par défaut"
			>
				🔑 Providers
			</button>
			<button class="archive-toggle" onclick={onopenTheme} title="Palette, accents, clair / sombre">
				◐ Apparence
			</button>
			<button class="status" onclick={onopenStatus} title="État du système">
				<span class="dot" class:ok={chat.connected === true} class:ko={chat.connected === false}
				></span>
				{#if chat.connected === true}
					Hermes {chat.version}
				{:else if chat.connected === false}
					Hors ligne
				{:else}
					connexion…
				{/if}
			</button>
		</footer>
	{/if}
</aside>

<style>
	.agent {
		color: var(--agent);
		font-size: 11px;
		margin-right: 1px;
	}
	/* A floating panel of its own, not a strip glued to the thread. When
	   collapsed it becomes the dark icon rail — the first column of the
	   design — so the two states swap surface as well as width. */
	.sidebar {
		display: flex;
		flex-direction: column;
		width: 268px;
		flex: 0 0 268px;
		height: 100%;
		background: var(--bg-raised);
		border-radius: var(--radius-panel);
		box-shadow: var(--shadow);
		overflow: hidden;
		transition: flex-basis 0.16s ease, width 0.16s ease;
	}
	/* The drawer takes focus when it opens so it is announced by name; a ring
	   drawn around the whole panel is not the signal, the announcement is —
	   same call as the modal card in `Modal.svelte`. */
	.sidebar:focus {
		outline: none;
	}
	.sidebar.collapsed {
		width: var(--rail-width);
		flex-basis: var(--rail-width);
		background: var(--rail);
		border-radius: var(--radius-rail);
	}
	.rail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		height: 100%;
		padding: 14px 0;
		color: var(--rail-ink);
	}
	.rail-spacer {
		flex: 1;
	}
	.rail-btn {
		width: 44px;
		height: 44px;
		border-radius: var(--radius-card);
		color: var(--rail-ink);
		opacity: 0.72;
		font-size: 17px;
		line-height: 1;
	}
	.rail-btn:hover {
		background: var(--rail-hover);
		opacity: 1;
	}
	.rail-btn.accent {
		background: var(--accent);
		color: var(--accent-ink);
		opacity: 1;
		border-radius: 50%;
	}
	.rail-btn.accent:hover {
		background: var(--accent);
	}
	.top {
		display: flex;
		gap: 4px;
		padding: 12px 12px 6px;
	}
	.new {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		padding: 9px 14px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--border);
		font-size: 14px;
	}
	.new:hover {
		background: var(--bg-hover);
	}
	.new span {
		color: var(--accent);
		font-size: 16px;
	}
	.icon-btn {
		padding: 0 8px;
		color: var(--text-faint);
		border-radius: var(--radius-pill);
	}
	.icon-btn:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.close {
		display: none;
	}
	.search {
		margin: 4px 12px 8px;
		padding: 9px 14px;
		background: var(--bg-sunken);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-pill);
		font-size: 13px;
	}
	.search:focus {
		border-color: var(--accent);
	}
	.list {
		flex: 1;
		overflow-y: auto;
		padding: 0 6px 10px;
	}
	.group {
		padding: 12px 8px 4px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
	.row {
		position: relative;
		display: flex;
		align-items: center;
		border-radius: var(--radius-card);
		/* Reserved so the selected row's stripe does not shift the text. */
		border-left: 3px solid transparent;
	}
	.row:hover {
		background: var(--bg-hover);
	}
	.row.active {
		background: var(--accent-soft);
		border-left-color: var(--accent);
	}
	.entry {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 8px 4px 8px 10px;
		text-align: left;
	}
	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13.5px;
	}
	.branch {
		color: var(--accent);
		margin-right: 3px;
	}
	.when {
		flex: 0 0 auto;
		font-size: 11px;
		color: var(--text-faint);
	}
	.more {
		padding: 6px 9px;
		color: var(--text-faint);
	}
	/* Renaming, pinning, branching, archiving and deleting all live behind this
	   ⋯ — and it used to be revealed by hover, which a finger does not have and
	   a Tab key does not either. It hides only where a pointer can bring it
	   back, and even there a focused row shows it. */
	@media (hover: hover) and (min-width: 821px) {
		.more {
			opacity: 0;
		}
		.row:hover .more,
		.row:focus-within .more,
		.row.active .more {
			opacity: 1;
		}
	}
	.rename {
		flex: 1;
		margin: 4px;
		padding: 5px 8px;
		background: var(--bg);
		border: 1px solid var(--accent);
		border-radius: 6px;
		font-size: 13.5px;
	}
	.menu {
		position: absolute;
		right: 6px;
		top: 100%;
		z-index: 20;
		display: flex;
		flex-direction: column;
		min-width: 158px;
		padding: 6px;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow);
	}
	.menu button {
		padding: 9px 12px;
		text-align: left;
		border-radius: 10px;
		font-size: 13px;
	}
	.menu button:hover {
		background: var(--bg-hover);
	}
	.menu .danger {
		color: var(--danger);
	}
	.empty {
		padding: 20px 12px;
		color: var(--text-faint);
		font-size: 13px;
		text-align: center;
		line-height: 1.5;
	}
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		/* Four entries no longer fit on one line at the sidebar's width. */
		flex-wrap: wrap;
		gap: 4px;
		padding: 7px 10px;
		border-top: 1px solid var(--border-soft);
		font-size: 11.5px;
	}
	.archive-toggle,
	.status {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		border-radius: var(--radius-pill);
		color: var(--text-faint);
		font-size: 11.5px;
		white-space: nowrap;
	}
	.archive-toggle:hover,
	.status:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--text-faint);
	}
	/* On the dark rail, "unknown" has to be read against the rail, not the
	   page — `--text-faint` disappears there. */
	.rail .dot {
		width: 9px;
		height: 9px;
		background: var(--rail-ink);
	}
	.dot.ok {
		background: var(--ok);
	}
	.dot.ko {
		background: var(--danger);
	}

	@media (max-width: 820px) {
		.sidebar {
			position: fixed;
			inset: 0 auto 0 0;
			z-index: 50;
			width: min(84vw, 300px);
			flex-basis: auto;
			padding-top: env(safe-area-inset-top);
			padding-bottom: env(safe-area-inset-bottom);
			/* A drawer sliding in from the left edge: only the right corners
			   are visible, so only they are rounded. */
			border-radius: 0 var(--radius-panel) var(--radius-panel) 0;
			transform: translateX(-100%);
			transition: transform 0.22s ease;
			box-shadow: var(--shadow);
		}
		.sidebar.open {
			transform: none;
		}
		/* Collapsing is a desktop affordance; on mobile the drawer already
		   gets out of the way. */
		.sidebar.collapsed {
			width: min(84vw, 300px);
			flex-basis: auto;
			background: var(--bg-raised);
			border-radius: 0 var(--radius-panel) var(--radius-panel) 0;
		}
		.close {
			display: block;
			min-width: 44px;
			min-height: 44px;
		}
		.collapse {
			display: none;
		}
		/* Thumb-sized targets, like every other control on a phone. The list
		   flexes, so a taller footer costs rows of conversation, not layout. */
		.entry {
			min-height: 44px;
			padding-top: 10px;
			padding-bottom: 10px;
		}
		.more {
			min-width: 44px;
			min-height: 44px;
		}
		.search {
			min-height: 44px;
		}
		.archive-toggle,
		.status {
			min-height: 44px;
		}
	}
</style>
