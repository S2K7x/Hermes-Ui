<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import Message from '$lib/components/Message.svelte';
	import ModelPicker from '$lib/components/ModelPicker.svelte';
	import Shortcuts from '$lib/components/Shortcuts.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import StatusPanel from '$lib/components/StatusPanel.svelte';
	import { chat } from '$lib/stores/chat.svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import { read, readJSON, write, writeJSON } from '$lib/client/storage';
	import { hasMod, modKey } from '$lib/client/platform';
	import { usageSummary } from '$lib/sessions';

	let sidebarOpen = $state(false);
	let sidebarCollapsed = $state(false);
	let paletteOpen = $state(false);
	let statusOpen = $state(false);
	let shortcutsOpen = $state(false);
	let narrow = $state(false);

	let scroller = $state<HTMLDivElement | null>(null);
	/** Autoscroll only while already at the bottom, so scrolling up to read
	 *  mid-stream isn't yanked back down. */
	let pinnedToBottom = $state(true);
	let composer = $state<Composer | null>(null);

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
		const onChange = (e: MediaQueryListEvent) => (narrow = e.matches);
		mq.addEventListener('change', onChange);

		void boot();

		return () => {
			mq.removeEventListener('change', onChange);
		};
	});

	async function boot() {
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

	function toggleTheme() {
		const root = document.documentElement;
		const next = root.dataset.theme === 'light' ? 'dark' : 'light';
		root.dataset.theme = next;
		write('hermes-theme', next);
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
		{ id: 'export', label: 'Exporter la conversation (markdown)', run: exportMarkdown },
		{ id: 'reload', label: 'Recharger la conversation', run: () => chat.reload() },
		...(chat.sessionId
			? [{ id: 'fork', label: 'Brancher la conversation', run: () => chat.forkSession(chat.sessionId!) }]
			: []),
		...(chat.canResend ? [{ id: 'resend', label: 'Renvoyer le dernier message', run: () => chat.resend() }] : []),
		{ id: 'theme', label: 'Basculer le thème clair / sombre', run: toggleTheme },
		{ id: 'shortcuts', label: 'Raccourcis clavier', hint: '?', run: () => (shortcutsOpen = true) }
	]);

	function onKeydown(event: KeyboardEvent) {
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
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app">
	<Sidebar
		open={sidebarOpen}
		collapsed={sidebarCollapsed && !narrow}
		onclose={() => (sidebarOpen = false)}
		ontoggleCollapse={toggleCollapse}
		onopenStatus={() => (statusOpen = true)}
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
				<ModelPicker />
				<button class="icon" onclick={toggleTheme} aria-label="Thème">◐</button>
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
						<h2>Hermes</h2>
						<p>
							Agent complet — terminal, navigateur, mémoire, skills et serveurs MCP — exécuté sur
							le Raspberry&nbsp;Pi.
						</p>
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
<StatusPanel open={statusOpen} onclose={() => (statusOpen = false)} />
<Shortcuts open={shortcutsOpen} onclose={() => (shortcutsOpen = false)} />

<style>
	.app {
		display: flex;
		height: 100dvh;
		overflow: hidden;
	}
	main {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border-soft);
		padding-top: max(10px, env(safe-area-inset-top));
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
		border-radius: 7px;
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
		background: rgba(224, 82, 82, 0.12);
		color: var(--danger);
		font-size: 13px;
	}
	.banner button {
		padding: 2px 10px;
		border: 1px solid currentColor;
		border-radius: 6px;
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
		bottom: 104px;
		transform: translateX(-50%);
		width: 32px;
		height: 32px;
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
	.composer-wrap {
		padding: 6px 16px max(12px, env(safe-area-inset-bottom));
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
		padding: 8px 14px;
		border: 1px solid var(--border-soft);
		border-radius: 20px;
		font-size: 13px;
		color: var(--text-muted);
		text-align: left;
	}
	.chips button:hover {
		background: var(--bg-hover);
		color: var(--text);
		border-color: var(--border);
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
		background: rgba(0, 0, 0, 0.45);
	}

	@media (max-width: 820px) {
		.burger {
			display: block;
		}
		.thread {
			padding: 16px 12px 8px;
		}
		.composer-wrap {
			padding: 6px 10px max(10px, env(safe-area-inset-bottom));
		}
		.chips button {
			font-size: 12.5px;
		}
	}
</style>
