<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import AgentPicker from '$lib/components/AgentPicker.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import Message from '$lib/components/Message.svelte';
	import ModelPicker from '$lib/components/ModelPicker.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import { agents } from '$lib/stores/agents.svelte';
	import { chat } from '$lib/stores/chat.svelte';
	import { prompts } from '$lib/stores/prompts.svelte';
	import { push } from '$lib/stores/push.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import { read, readJSON, write, writeJSON } from '$lib/client/storage';
	import { hasMod, modKey } from '$lib/client/platform';
	import { usageSummary } from '$lib/sessions';
	import { agentColor, agentLabel, directReports } from '$lib/agents';
	import { lazyComponent } from '$lib/client/lazy.svelte';

	let sidebarOpen = $state(false);
	let sidebarCollapsed = $state(false);
	let paletteOpen = $state(false);
	let statusOpen = $state(false);
	let skillsOpen = $state(false);
	let providersOpen = $state(false);
	let jobsOpen = $state(false);
	let agentsOpen = $state(false);
	let shortcutsOpen = $state(false);
	let themeOpen = $state(false);
	let narrow = $state(false);
	/** How much of the layout viewport the soft keyboard is covering. */
	let keyboard = $state(0);

	let scroller = $state<HTMLDivElement | null>(null);
	/** Autoscroll only while already at the bottom, so scrolling up to read
	 *  mid-stream isn't yanked back down. */
	let pinnedToBottom = $state(true);
	let composer = $state<Composer | null>(null);

	/**
	 * The settings panels, fetched on first open rather than at boot.
	 *
	 * None of them is on screen when the app starts, yet statically imported
	 * they were the biggest part of the page bundle — parsed and compiled on
	 * the Pi's CPU before the first message could be painted. Their own
	 * `$effect(() => { if (open) … })` already gates every fetch they do, so
	 * mounting them late changes nothing but when the code arrives.
	 */
	const panels = {
		status: lazyComponent(() => import('$lib/components/StatusPanel.svelte')),
		jobs: lazyComponent(() => import('$lib/components/JobsPanel.svelte')),
		agents: lazyComponent(() => import('$lib/components/AgentsPanel.svelte')),
		skills: lazyComponent(() => import('$lib/components/SkillsPanel.svelte')),
		providers: lazyComponent(() => import('$lib/components/ProvidersPanel.svelte')),
		theme: lazyComponent(() => import('$lib/components/ThemePanel.svelte')),
		shortcuts: lazyComponent(() => import('$lib/components/Shortcuts.svelte'))
	};

	/** A chunk that cannot be fetched must say so, not leave a dead button. */
	function reveal(panel: { load: () => Promise<void> }) {
		void panel.load().catch(() => toasts.error("Ce panneau n'a pas pu être chargé. Réessayez."));
	}

	$effect(() => {
		if (statusOpen) reveal(panels.status);
		if (jobsOpen) reveal(panels.jobs);
		if (agentsOpen) reveal(panels.agents);
		if (skillsOpen) reveal(panels.skills);
		if (providersOpen) reveal(panels.providers);
		if (themeOpen) reveal(panels.theme);
		if (shortcutsOpen) reveal(panels.shortcuts);
	});

	const SUGGESTIONS = [
		"Quel est l'état du Raspberry Pi (CPU, RAM, disque) ?",
		'Résume les nouveautés de ma veille technique du jour.',
		'Cherche les prochains trains pour Tel Aviv.',
		'Liste les conteneurs Docker qui tournent et leur santé.'
	];

	onMount(() => {
		sidebarCollapsed = readJSON('hermes-sidebar-collapsed', false);

		const mq = window.matchMedia('(max-width: 820px)');
		narrow = mq.matches;
		const onChange = (e: MediaQueryListEvent) => {
			narrow = e.matches;
			// A drawer left open while the window grows would become a column
			// with a scrim still over the page — and an Escape that no longer
			// means "close me". It stops being a drawer, so it closes.
			if (!narrow) sidebarOpen = false;
		};
		mq.addEventListener('change', onChange);

		/**
		 * Keep the composer above the iOS keyboard.
		 *
		 * `interactive-widget=resizes-visual` is ignored in standalone mode, so
		 * in an installed PWA the layout viewport keeps its full height and the
		 * keyboard simply covers the bottom of the page — composer included.
		 * The visual viewport is the only thing that reports the real, usable
		 * area, hence this rather than a media query.
		 */
		const vv = window.visualViewport;
		const onViewport = () => {
			if (!vv) return;
			const hidden = window.innerHeight - vv.height - vv.offsetTop;
			// Small deltas are browser chrome (the Safari toolbar), not a keyboard.
			keyboard = hidden > 24 ? Math.round(hidden) : 0;
			if (pinnedToBottom) tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
		};
		vv?.addEventListener('resize', onViewport);
		vv?.addEventListener('scroll', onViewport);

		void boot();

		return () => {
			mq.removeEventListener('change', onChange);
			vv?.removeEventListener('resize', onViewport);
			vv?.removeEventListener('scroll', onViewport);
		};
	});

	async function boot() {
		// Load the saved prompts alongside the session list so the command
		// palette can offer them right away; a failure here is silent.
		void prompts.ensureLoaded();
		// The roster decorates the sidebar and the header, so it is wanted as
		// early as the session list; a failure here leaves conversations
		// unlabelled, nothing more.
		void agents.ensureLoaded();
		// Not for the settings panel — this is what starts reporting whether the
		// app is on screen, which decides if a finished turn notifies.
		void push.init();
		await chat.init();
		// ?s=<id> deep-links a conversation; otherwise resume the last one
		// that was open, like reopening Claude.ai.
		const wanted = new URLSearchParams(location.search).get('s') ?? read('hermes-last-session');
		const target = chat.sessions.find((s) => s.id === wanted) ?? chat.sessions[0];
		if (target) await chat.openSession(target.id);
	}

	onDestroy(() => chat.dispose());

	$effect(() => {
		if (chat.sessionId) write('hermes-last-session', chat.sessionId);
	});

	function onScroll() {
		if (!scroller) return;
		const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
		pinnedToBottom = gap < 90;
	}

	$effect(() => {
		// Re-runs on every token: cheap enough, and keeps the view glued.
		void chat.messages.at(-1)?.content;
		void chat.messages.length;
		if (!pinnedToBottom) return;
		tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
	});

	function scrollToBottom() {
		scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
		pinnedToBottom = true;
	}

	/** Two modals must never stack: the status panel steps aside. */
	function openJobsFromStatus() {
		statusOpen = false;
		jobsOpen = true;
	}

	/**
	 * A settings panel opened from the sidebar replaces it.
	 *
	 * On a phone the sidebar is a drawer over the thread, so the two would
	 * otherwise stack — a dialog on top of a dialog, each trapping Tab. On a
	 * wide screen the sidebar is a column and closing it is a no-op.
	 */
	function openFromSidebar(open: () => void) {
		open();
		sidebarOpen = false;
	}

	function toggleCollapse() {
		sidebarCollapsed = !sidebarCollapsed;
		writeJSON('hermes-sidebar-collapsed', sidebarCollapsed);
	}

	async function exportMarkdown() {
		const text = chat.toMarkdown();
		try {
			await navigator.clipboard.writeText(text);
			toasts.success('Conversation copiée en markdown.');
		} catch {
			// Clipboard is blocked outside a secure context or without a user
			// gesture on some browsers — fall back to a download.
			const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
			const a = document.createElement('a');
			a.href = url;
			a.download = `${chat.current?.title || 'conversation'}.md`;
			a.click();
			URL.revokeObjectURL(url);
		}
	}

	let mod = $state('Ctrl');
	$effect(() => {
		mod = modKey();
	});

	const commands = $derived([
		{ id: 'new', label: 'Nouvelle discussion', hint: `${mod} ⇧O`, run: () => chat.newSession() },
		{ id: 'status', label: 'État du système', hint: `${mod} /`, run: () => (statusOpen = true) },
		{ id: 'skills', label: 'Modifier les skills', run: () => (skillsOpen = true) },
		{ id: 'agents', label: "Équipe d'agents", run: () => (agentsOpen = true) },
		{ id: 'jobs', label: 'Tâches planifiées', run: () => (jobsOpen = true) },
		{ id: 'providers', label: 'Providers (clés API et comptes)', run: () => (providersOpen = true) },
		{ id: 'export', label: 'Exporter la conversation (markdown)', run: exportMarkdown },
		{ id: 'reload', label: 'Recharger la conversation', run: () => chat.reload() },
		...(chat.sessionId
			? [{ id: 'fork', label: 'Brancher la conversation', run: () => chat.forkSession(chat.sessionId!) }]
			: []),
		...(chat.canResend ? [{ id: 'resend', label: 'Renvoyer le dernier message', run: () => chat.resend() }] : []),
		// One entry per saved prompt: ⌘K then a few letters is the fastest way
		// to reuse one on the desktop.
		...prompts.items.map((p) => ({
			id: `prompt:${p.id}`,
			label: `Prompt : ${p.title}`,
			run: () => composer?.insert(p.text)
		})),
		{ id: 'appearance', label: 'Apparence (palette et accents)', run: () => (themeOpen = true) },
		{ id: 'theme', label: 'Basculer le thème clair / sombre', run: () => theme.toggleMode() },
		{ id: 'shortcuts', label: 'Raccourcis clavier', hint: '?', run: () => (shortcutsOpen = true) }
	]);

	function onKeydown(event: KeyboardEvent) {
		// The skills, providers, jobs, agents and theme panels are modal and own
		// their own Escape while open; letting these shortcuts through would
		// fire behind them.
		if (skillsOpen || providersOpen || jobsOpen || agentsOpen || themeOpen) return;
		const meta = hasMod(event);
		const target = event.target as HTMLElement | null;
		const typing =
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target?.isContentEditable;

		if (meta && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			paletteOpen = !paletteOpen;
			return;
		}
		if (meta && event.shiftKey && event.key.toLowerCase() === 'o') {
			event.preventDefault();
			chat.newSession();
			return;
		}
		if (meta && event.key === '/') {
			event.preventDefault();
			statusOpen = !statusOpen;
			return;
		}
		if (event.key === 'Escape') {
			if (paletteOpen || statusOpen || shortcutsOpen) {
				paletteOpen = statusOpen = shortcutsOpen = false;
			} else if (sidebarOpen) {
				// On a narrow window the drawer covers the thread and traps Tab:
				// Escape is the way out, as it is for every other modal surface.
				sidebarOpen = false;
			} else if (chat.streaming) {
				chat.stop();
			}
			return;
		}
		// Bare keys only when not typing, so "?" in a message stays a "?".
		if (typing) return;
		if (event.key === '?') {
			event.preventDefault();
			shortcutsOpen = true;
		} else if (event.key === '/') {
			event.preventDefault();
			composer?.focus();
		}
	}

	let title = $derived(chat.current?.title || 'Hermes');
	let usage = $derived(usageSummary(chat.current));
	let activeAgent = $derived(agents.byId(chat.activeAgentId));
	let activeTeam = $derived(activeAgent ? directReports(agents.items, activeAgent) : []);
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app" style="--keyboard: {keyboard}px">
	<Sidebar
		open={sidebarOpen}
		drawer={narrow}
		collapsed={sidebarCollapsed && !narrow}
		onclose={() => (sidebarOpen = false)}
		ontoggleCollapse={toggleCollapse}
		onopenStatus={() => openFromSidebar(() => (statusOpen = true))}
		onopenSkills={() => openFromSidebar(() => (skillsOpen = true))}
		onopenProviders={() => openFromSidebar(() => (providersOpen = true))}
		onopenJobs={() => openFromSidebar(() => (jobsOpen = true))}
		onopenAgents={() => openFromSidebar(() => (agentsOpen = true))}
		onopenTheme={() => openFromSidebar(() => (themeOpen = true))}
	/>

	{#if sidebarOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="scrim" onclick={() => (sidebarOpen = false)}></div>
	{/if}

	<main>
		<header>
			<button class="burger" onclick={() => (sidebarOpen = true)} aria-label="Discussions">☰</button>
			<div class="heading">
				<h1>{title}</h1>
				{#if usage}<span class="usage" title="tokens entrée / sortie et coût estimé">{usage}</span>{/if}
			</div>
			<div class="head-actions">
				<button class="icon" onclick={() => (paletteOpen = true)} aria-label="Rechercher (⌘K)"
					>⌕</button
				>
				<AgentPicker onmanage={() => (agentsOpen = true)} />
				<ModelPicker />
				<button class="icon" onclick={() => (themeOpen = true)} aria-label="Apparence">◐</button>
			</div>
		</header>

		{#if chat.connected === false}
			<div class="banner" role="alert">
				<span>⚠️ Hermes est injoignable — nouvelle tentative en cours.</span>
				<button onclick={() => chat.refreshHealth()}>Réessayer</button>
			</div>
		{/if}

		<div class="scroll" bind:this={scroller} onscroll={onScroll}>
			<div class="thread">
				{#if chat.loadingHistory}
					<p class="status">Chargement…</p>
				{:else if chat.messages.length === 0}
					<div class="welcome">
						<h2>{activeAgent ? agentLabel(activeAgent) : 'Hermes'}</h2>
						<p>
							{#if activeAgent}
								{activeAgent.role || 'Agent personnalisé.'}
							{:else}
								Agent complet — terminal, navigateur, mémoire, skills et serveurs MCP — exécuté sur
								le Raspberry&nbsp;Pi.
							{/if}
						</p>

						{#if agents.items.length > 0}
							<div class="who">
								{#each agents.items as agent (agent.id)}
									<button
										class="agent-chip"
										class:sel={agent.id === chat.activeAgentId}
										style="--agent: {agentColor(agent)}"
										title={agent.role}
										onclick={() => chat.setAgent(agent.id)}
									>
										<span class="dot"></span>{agentLabel(agent)}
									</button>
								{/each}
								<button
									class="agent-chip"
									class:sel={!chat.activeAgentId}
									onclick={() => chat.setAgent('')}>Sans agent</button
								>
								<button class="agent-chip ghost" onclick={() => (agentsOpen = true)}>＋ Gérer</button>
							</div>
							{#if activeTeam.length > 0}
								<p class="team">
									Chef d'équipe : peut confier du travail à {activeTeam
										.map((a) => a.name)
										.join(', ')} via <code>delegate_task</code>.
								</p>
							{/if}
						{/if}

						<div class="chips">
							{#each SUGGESTIONS as suggestion (suggestion)}
								<button onclick={() => chat.send(suggestion)}>{suggestion}</button>
							{/each}
						</div>
						{#if chat.toolCount > 0}
							<p class="meta">
								{chat.toolCount} outils
								{#if chat.mcpTools.length}· {chat.mcpTools.length} via MCP{/if}
								{#if chat.skills.length}· {chat.skills.length} skills{/if}
							</p>
						{/if}
					</div>
				{/if}

				{#each chat.messages as message (message.id)}
					<Message
						{message}
						onfork={message.role === 'assistant' && chat.sessionId
							? () => chat.forkSession(chat.sessionId!)
							: undefined}
						onreload={() => chat.reload()}
						onresend={message.role === 'assistant' && chat.canResend ? () => chat.resend() : undefined}
					/>
				{/each}
			</div>
		</div>

		{#if !pinnedToBottom && chat.messages.length > 0}
			<button class="to-bottom" onclick={scrollToBottom} aria-label="Aller en bas">↓</button>
		{/if}

		<div class="composer-wrap">
			<Composer bind:this={composer} />
			<p class="disclaimer">
				Les outils s'exécutent sur le Pi. Vérifiez les commandes sensibles.
				<button class="link" onclick={() => (shortcutsOpen = true)}>Raccourcis</button>
			</p>
		</div>
	</main>
</div>

<CommandPalette open={paletteOpen} onclose={() => (paletteOpen = false)} {commands} />

<!-- Each panel appears in the tree only once its chunk has landed; from then on
     it stays, so reopening is as immediate as it was before. -->
{#if panels.status.current}
	{@const StatusPanel = panels.status.current}
	<StatusPanel open={statusOpen} onclose={() => (statusOpen = false)} onopenJobs={openJobsFromStatus} />
{/if}
{#if panels.jobs.current}
	{@const JobsPanel = panels.jobs.current}
	<JobsPanel open={jobsOpen} onclose={() => (jobsOpen = false)} />
{/if}
{#if panels.agents.current}
	{@const AgentsPanel = panels.agents.current}
	<AgentsPanel open={agentsOpen} onclose={() => (agentsOpen = false)} />
{/if}
{#if panels.skills.current}
	{@const SkillsPanel = panels.skills.current}
	<SkillsPanel open={skillsOpen} onclose={() => (skillsOpen = false)} />
{/if}
{#if panels.providers.current}
	{@const ProvidersPanel = panels.providers.current}
	<ProvidersPanel open={providersOpen} onclose={() => (providersOpen = false)} />
{/if}
{#if panels.theme.current}
	{@const ThemePanel = panels.theme.current}
	<ThemePanel open={themeOpen} onclose={() => (themeOpen = false)} />
{/if}
{#if panels.shortcuts.current}
	{@const Shortcuts = panels.shortcuts.current}
	<Shortcuts open={shortcutsOpen} onclose={() => (shortcutsOpen = false)} />
{/if}

<style>
	/* Panels float: the page background shows between them, which is what
	   gives the layout its depth. On a phone that margin is just lost width,
	   so the media query below takes it all back. */
	.app {
		display: flex;
		gap: var(--gap-panel);
		height: 100dvh;
		padding: var(--gap-panel);
		padding-top: max(var(--gap-panel), env(safe-area-inset-top));
		padding-bottom: max(var(--gap-panel), env(safe-area-inset-bottom));
		overflow: hidden;
	}
	main {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border-radius: var(--radius-panel);
		box-shadow: var(--shadow);
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 18px;
		border-bottom: 1px solid var(--border-soft);
	}
	.heading {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	h1 {
		margin: 0;
		font-size: 15px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.usage {
		flex: 0 0 auto;
		font-size: 11px;
		color: var(--text-faint);
	}
	.head-actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.icon {
		padding: 4px 8px;
		color: var(--text-muted);
		border-radius: var(--radius-pill);
		font-size: 15px;
		line-height: 1.2;
	}
	.icon:hover {
		background: var(--bg-hover);
	}
	.burger {
		display: none;
		padding: 2px 6px;
		font-size: 17px;
		color: var(--text-muted);
	}
	.banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 7px 14px;
		background: var(--danger-soft);
		color: var(--danger);
		font-size: 13px;
	}
	.banner button {
		padding: 2px 10px;
		border: 1px solid currentColor;
		border-radius: var(--radius-pill);
		font-size: 12.5px;
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.thread {
		max-width: 780px;
		margin: 0 auto;
		padding: 24px 16px 8px;
	}
	.to-bottom {
		position: absolute;
		left: 50%;
		bottom: calc(104px + var(--keyboard, 0px));
		transform: translateX(-50%);
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		box-shadow: var(--shadow);
		color: var(--text-muted);
		font-size: 14px;
	}
	.to-bottom:hover {
		color: var(--text);
	}
	/* `--keyboard` is what the visual viewport says the soft keyboard is
	   covering; see the listener in onMount. It is 0 on the desktop. */
	.composer-wrap {
		padding: 6px 16px 12px;
		padding-bottom: calc(12px + var(--keyboard, 0px));
	}
	.disclaimer {
		max-width: 780px;
		margin: 6px auto 0;
		text-align: center;
		font-size: 11px;
		color: var(--text-faint);
	}
	.link {
		color: var(--text-faint);
		text-decoration: underline;
		font-size: 11px;
	}
	.link:hover {
		color: var(--text);
	}
	.status {
		text-align: center;
		color: var(--text-faint);
		font-size: 13px;
	}
	.welcome {
		padding: 9vh 0 0;
		text-align: center;
		color: var(--text-muted);
	}
	.welcome h2 {
		margin: 0 0 8px;
		font-size: 26px;
		color: var(--text);
	}
	.welcome > p {
		max-width: 440px;
		margin: 0 auto;
		font-size: 14px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin: 26px auto 0;
		max-width: 620px;
	}
	.chips button {
		padding: 10px 16px;
		min-height: 44px;
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-pill);
		font-size: 13px;
		color: var(--text-muted);
		text-align: left;
	}
	.chips button:hover {
		background: var(--bg-hover);
		color: var(--text);
		border-color: var(--border);
	}
	.who {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 7px;
		margin: 22px auto 0;
		max-width: 620px;
	}
	.agent-chip {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		min-height: 36px;
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-pill);
		font-size: 12.5px;
		color: var(--text-muted);
	}
	.agent-chip:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.agent-chip.sel {
		border-color: var(--agent, var(--accent));
		color: var(--text);
	}
	.agent-chip.ghost {
		border-style: dashed;
	}
	.agent-chip .dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--agent);
	}
	.team {
		max-width: 520px;
		margin: 12px auto 0 !important;
		font-size: 12px !important;
		color: var(--text-faint);
	}
	.team code {
		font-size: 11.5px;
	}
	.meta {
		margin-top: 22px !important;
		font-size: 12px !important;
		color: var(--text-faint);
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: var(--scrim);
	}

	/* Phone: full bleed. Floating cards with 14px margins on a 390px screen
	   are just lost width — same colours, same roundness, no gutters. */
	@media (max-width: 820px) {
		.app {
			gap: 0;
			padding: 0;
		}
		main {
			border-radius: 0;
			box-shadow: none;
		}
		header {
			padding: 10px 12px;
			padding-top: max(10px, env(safe-area-inset-top));
		}
		.burger {
			display: block;
			min-width: 44px;
			min-height: 44px;
		}
		.icon {
			min-width: 40px;
			min-height: 40px;
		}
		.thread {
			padding: 16px 12px 8px;
		}
		.composer-wrap {
			padding: 6px 10px 10px;
			/* Only one of the two is ever non-zero: the keyboard covers the home
			   indicator while it is up. */
			padding-bottom: calc(10px + max(env(safe-area-inset-bottom), var(--keyboard, 0px)));
		}
		.chips button {
			font-size: 12.5px;
		}
	}
</style>
