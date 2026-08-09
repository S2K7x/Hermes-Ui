<script lang="ts">
	import { chat } from '$lib/stores/chat.svelte';
	import { groupSessions, matchesQuery, relativeTime, sessionLabel, activityAt } from '$lib/sessions';
	import type { HermesSession } from '$lib/types';

	interface Props {
		open: boolean;
		collapsed: boolean;
		onclose: () => void;
		ontoggleCollapse: () => void;
		onopenStatus: () => void;
	}
	let { open, collapsed, onclose, ontoggleCollapse, onopenStatus }: Props = $props();

	let filter = $state('');
	let showArchived = $state(false);
	let renaming = $state<string | null>(null);
	let renameValue = $state('');
	let menuFor = $state<string | null>(null);

	let visible = $derived(
		chat.sessions
			.filter((s) => Boolean(s.archived) === showArchived)
			.filter((s) => matchesQuery(s, filter))
	);
	let groups = $derived(groupSessions(visible));
	let archivedCount = $derived(chat.sessions.filter((s) => s.archived).length);

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
</script>

<svelte:window onclick={onWindowClick} />

<aside class="sidebar" class:open class:collapsed>
	{#if collapsed}
		<div class="rail">
			<button class="rail-btn" onclick={ontoggleCollapse} aria-label="Déplier les discussions"
				>»</button
			>
			<button class="rail-btn accent" onclick={() => chat.newSession()} aria-label="Nouvelle discussion"
				>＋</button
			>
			<div class="rail-spacer"></div>
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
							<button class="entry" onclick={() => pick(entry.id)} title={entry.preview ?? ''}>
								<span class="title">
									{#if entry.parent_session_id}<span class="branch" title="branche">⑂</span>{/if}
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
					{#if chat.loadingSessions}
						Chargement…
					{:else if filter}
						Aucun résultat pour « {filter} ».
					{:else if showArchived}
						Aucune conversation archivée.
					{:else}
						Aucune discussion pour l'instant.
					{/if}
				</p>
			{/if}
		</nav>

		<footer>
			{#if archivedCount > 0 || showArchived}
				<button class="archive-toggle" onclick={() => (showArchived = !showArchived)}>
					{showArchived ? '← Discussions' : `Archivées (${archivedCount})`}
				</button>
			{/if}
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
	.sidebar {
		display: flex;
		flex-direction: column;
		width: 268px;
		flex: 0 0 268px;
		height: 100%;
		background: var(--bg-sunken);
		border-right: 1px solid var(--border-soft);
		transition: flex-basis 0.16s ease, width 0.16s ease;
	}
	.sidebar.collapsed {
		width: 52px;
		flex-basis: 52px;
	}
	.rail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		height: 100%;
		padding: 10px 0;
	}
	.rail-spacer {
		flex: 1;
	}
	.rail-btn {
		width: 34px;
		height: 34px;
		border-radius: 9px;
		color: var(--text-muted);
		font-size: 15px;
		line-height: 1;
	}
	.rail-btn:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.rail-btn.accent {
		color: var(--accent);
		border: 1px solid var(--border);
	}
	.top {
		display: flex;
		gap: 4px;
		padding: 10px 10px 6px;
	}
	.new {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 9px 12px;
		border-radius: 9px;
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
		border-radius: 7px;
	}
	.icon-btn:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.close {
		display: none;
	}
	.search {
		margin: 4px 10px 8px;
		padding: 7px 10px;
		background: var(--bg);
		border: 1px solid var(--border-soft);
		border-radius: 8px;
		font-size: 13px;
		outline: none;
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
		border-radius: 8px;
	}
	.row:hover {
		background: var(--bg-hover);
	}
	.row.active {
		background: var(--accent-soft);
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
		opacity: 0;
	}
	.row:hover .more,
	.row.active .more {
		opacity: 1;
	}
	.rename {
		flex: 1;
		margin: 4px;
		padding: 5px 8px;
		background: var(--bg);
		border: 1px solid var(--accent);
		border-radius: 6px;
		font-size: 13.5px;
		outline: none;
	}
	.menu {
		position: absolute;
		right: 6px;
		top: 100%;
		z-index: 20;
		display: flex;
		flex-direction: column;
		min-width: 158px;
		padding: 4px;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: 9px;
		box-shadow: var(--shadow);
	}
	.menu button {
		padding: 7px 10px;
		text-align: left;
		border-radius: 6px;
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
		gap: 6px;
		padding: 7px 10px;
		border-top: 1px solid var(--border-soft);
		font-size: 11.5px;
	}
	.archive-toggle,
	.status {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 7px;
		border-radius: 6px;
		color: var(--text-faint);
		font-size: 11.5px;
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
		}
		.close {
			display: block;
		}
		.collapse {
			display: none;
		}
	}
</style>
