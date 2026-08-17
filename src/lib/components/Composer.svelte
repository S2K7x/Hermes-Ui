<script lang="ts">
	import { chat } from '$lib/stores/chat.svelte';
	import { prompts } from '$lib/stores/prompts.svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import { matchPrompts } from '$lib/prompts';
	import { uid } from '$lib/transcript';
	import type { Attachment } from '$lib/types';

	let text = $state('');
	let attachments = $state<Attachment[]>([]);
	let textarea = $state<HTMLTextAreaElement | null>(null);
	let dragging = $state(false);
	let notice = $state<string | null>(null);

	// Skills palette: typing "/" at the start of the composer opens it.
	let paletteOpen = $state(false);
	let paletteIndex = $state(0);
	let paletteQuery = $derived(text.startsWith('/') ? text.slice(1).split(/\s/)[0].toLowerCase() : '');
	let paletteMatches = $derived(
		paletteOpen
			? chat.skills.filter((s) => s.name.toLowerCase().includes(paletteQuery)).slice(0, 8)
			: []
	);

	// Saved prompts: the library lives server-side, so it is the same on the
	// phone and on the desktop.
	let promptsOpen = $state(false);
	let promptFilter = $state('');
	let promptMatches = $derived(matchPrompts(prompts.items, promptFilter));
	const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

	const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

	function autosize() {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 260)}px`;
	}

	function flash(message: string) {
		notice = message;
		setTimeout(() => (notice = null), 4000);
	}

	// Images travel as base64 inside the JSON body, which inflates them ~33%.
	// Keep the total under the server's BODY_SIZE_LIMIT (8 MB) with room to
	// spare, and say so before the turn fails upstream.
	const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
	let totalBytes = $derived(attachments.reduce((sum, a) => sum + a.size, 0));

	/**
	 * Only images can be attached. The Hermes API rejects uploaded files,
	 * file_id references and non-image data: URLs with
	 * 400 unsupported_content_type, so anything else is refused here with an
	 * explanation rather than failing mid-turn.
	 */
	async function addFiles(files: FileList | File[]) {
		for (const file of Array.from(files)) {
			if (!file.type.startsWith('image/')) {
				flash(`« ${file.name} » ignoré : seules les images sont acceptées par l'API Hermes.`);
				continue;
			}
			if (file.size > MAX_IMAGE_BYTES) {
				flash(`« ${file.name} » ignoré : dépasse 4 Mo.`);
				continue;
			}
			if (totalBytes + file.size > MAX_TOTAL_BYTES) {
				flash(`« ${file.name} » ignoré : le lot dépasserait 5 Mo au total.`);
				continue;
			}
			const dataUrl = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result));
				reader.onerror = reject;
				reader.readAsDataURL(file);
			});
			attachments.push({
				id: uid('att'),
				name: file.name || 'image',
				mime: file.type,
				dataUrl,
				size: file.size
			});
		}
	}

	function onPaste(event: ClipboardEvent) {
		const files = Array.from(event.clipboardData?.files ?? []);
		if (files.length) {
			event.preventDefault();
			addFiles(files);
		}
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		if (event.dataTransfer?.files.length) addFiles(event.dataTransfer.files);
	}

	function onKeydown(event: KeyboardEvent) {
		// Escape closes the prompt library first — without stopping here it
		// would reach the page handler and detach a running turn.
		if (promptsOpen && event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			promptsOpen = false;
			return;
		}
		if (paletteOpen && paletteMatches.length) {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				paletteIndex = (paletteIndex + 1) % paletteMatches.length;
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				paletteIndex = (paletteIndex - 1 + paletteMatches.length) % paletteMatches.length;
				return;
			}
			if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
				event.preventDefault();
				choose(paletteMatches[paletteIndex].name);
				return;
			}
			if (event.key === 'Escape') {
				paletteOpen = false;
				return;
			}
		}
		// Enter sends, Shift+Enter newlines — but never on a soft keyboard,
		// where Enter has to insert a line break.
		if (event.key === 'Enter' && !event.shiftKey && !isTouch()) {
			event.preventDefault();
			submit();
		}
	}

	const isTouch = () => window.matchMedia('(hover: none)').matches;

	function choose(name: string) {
		text = `/${name} `;
		paletteOpen = false;
		textarea?.focus();
	}

	function onInput() {
		autosize();
		paletteOpen = text.startsWith('/') && !text.includes('\n') && chat.skills.length > 0;
		paletteIndex = 0;
	}

	/** Called from the page's "/" shortcut and the command palette. */
	export function focus() {
		textarea?.focus();
	}

	/**
	 * Drop a saved prompt into the composer. Appended, never substituted: a
	 * half-typed message must survive a mistaken tap on the library.
	 */
	export function insert(value: string) {
		const kept = text.replace(/\s+$/, '');
		text = kept ? `${kept}\n\n${value}` : value;
		promptsOpen = false;
		paletteOpen = false;
		textarea?.focus();
		queueMicrotask(autosize);
	}

	function togglePrompts() {
		promptsOpen = !promptsOpen;
		if (promptsOpen) {
			promptFilter = '';
			void prompts.ensureLoaded();
		}
	}

	async function saveCurrent() {
		if (await prompts.add(text)) toasts.success('Prompt enregistré.');
	}

	async function submit() {
		if (chat.streaming) return;
		const payload = text;
		const files = attachments;
		if (!payload.trim() && files.length === 0) return;
		text = '';
		attachments = [];
		paletteOpen = false;
		promptsOpen = false;
		queueMicrotask(autosize);
		await chat.send(payload, files);
	}
</script>

<div
	class="composer"
	class:dragging
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={onDrop}
	role="group"
>
	{#if notice}
		<div class="notice">{notice}</div>
	{/if}

	{#if promptsOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="pscrim" onclick={() => (promptsOpen = false)}></div>
		<div class="palette prompts">
			<div class="p-head">
				<span>Prompts enregistrés</span>
				<button class="p-x" onclick={() => (promptsOpen = false)} aria-label="Fermer">✕</button>
			</div>

			{#if text.trim()}
				<button
					class="p-save"
					onclick={saveCurrent}
					disabled={prompts.saving || Boolean(prompts.loadError)}
				>
					＋ Enregistrer le message en cours
				</button>
			{/if}

			{#if prompts.items.length > 5}
				<input
					class="p-filter"
					bind:value={promptFilter}
					placeholder="Filtrer…"
					aria-label="Filtrer les prompts"
				/>
			{/if}

			<div class="p-list">
				{#each promptMatches as prompt (prompt.id)}
					<div class="p-row">
						<button class="p-use" onclick={() => insert(prompt.text)}>
							<span class="p-title">{prompt.title}</span>
							<!-- A one-line prompt IS its title: printing it twice says nothing. -->
							{#if oneLine(prompt.text) !== prompt.title}
								<span class="p-body">{oneLine(prompt.text)}</span>
							{/if}
						</button>
						<button
							class="p-del"
							onclick={() => prompts.remove(prompt.id)}
							disabled={prompts.saving}
							aria-label="Supprimer ce prompt">✕</button
						>
					</div>
				{/each}

				{#if prompts.loadError}
					<!-- Never "Chargement…" here: a failed load is not a slow one, and
					     saving on top of a library we could not read would replace it. -->
					<p class="p-none p-fail">
						La bibliothèque n'a pas pu être chargée, l'enregistrement est donc
						bloqué pour ne rien effacer.<br />{prompts.loadError}
					</p>
					<button class="p-retry" onclick={() => prompts.reload()}>Réessayer</button>
				{:else if prompts.items.length === 0}
					<p class="p-none">
						{prompts.loaded
							? 'Aucun prompt enregistré. Écrivez un message, puis enregistrez-le ici pour le retrouver sur tous vos appareils.'
							: 'Chargement…'}
					</p>
				{:else if promptMatches.length === 0}
					<p class="p-none">Aucun prompt ne correspond.</p>
				{/if}
			</div>
		</div>
	{/if}

	{#if paletteOpen && !promptsOpen && paletteMatches.length}
		<div class="palette">
			{#each paletteMatches as skill, i (skill.name)}
				<button class:sel={i === paletteIndex} onclick={() => choose(skill.name)}>
					<span class="sk-name">/{skill.name}</span>
					<span class="sk-desc">{skill.description ?? ''}</span>
				</button>
			{/each}
		</div>
	{/if}

	{#if attachments.length}
		<div class="attachments">
			{#each attachments as att (att.id)}
				<div class="att">
					<img src={att.dataUrl} alt={att.name} />
					<button
						aria-label="Retirer"
						onclick={() => (attachments = attachments.filter((a) => a.id !== att.id))}>✕</button
					>
				</div>
			{/each}
		</div>
	{/if}

	<div class="row">
		<label class="attach" title="Joindre une image">
			📎
			<input
				type="file"
				accept="image/*"
				multiple
				aria-label="Joindre une image"
				onchange={(e) => {
					const input = e.currentTarget;
					if (input.files) addFiles(input.files);
					input.value = '';
				}}
			/>
		</label>

		<button
			class="attach prompt-btn"
			class:on={promptsOpen}
			onclick={togglePrompts}
			title="Prompts enregistrés"
			aria-label="Prompts enregistrés"
			aria-expanded={promptsOpen}>🔖</button
		>

		<textarea
			bind:this={textarea}
			bind:value={text}
			oninput={onInput}
			onkeydown={onKeydown}
			onpaste={onPaste}
			rows="1"
			placeholder={chat.streaming ? 'Hermes travaille…' : 'Écrire à Hermes…  (/ pour les skills)'}
		></textarea>

		{#if chat.streaming}
			<!-- "Détacher", not "Stop": Hermes cannot interrupt a Sessions API
			     turn, so this only stops watching it. -->
			<button
				class="send stop"
				onclick={() => chat.stop()}
				title="Arrêter l'affichage (l'agent termine en arrière-plan)">■</button
			>
		{:else}
			<button
				class="send"
				onclick={submit}
				disabled={!text.trim() && attachments.length === 0}
				title="Envoyer">↑</button
			>
		{/if}
	</div>
</div>

<style>
	.composer {
		position: relative;
		margin: 0 auto;
		width: 100%;
		max-width: 780px;
		padding: 8px;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-bubble);
		box-shadow: var(--shadow);
	}
	.composer.dragging {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	/* The textarea has no ring of its own — a box inside a box — so the box
	   itself is what says the keyboard is writing here. */
	.composer:focus-within {
		border-color: var(--focus);
	}
	.row {
		display: flex;
		align-items: flex-end;
		gap: 6px;
	}
	textarea {
		flex: 1;
		min-height: 26px;
		max-height: 260px;
		padding: 6px 4px;
		background: none;
		border: none;
		outline: none;
		resize: none;
		line-height: 1.5;
	}
	.attach {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 50%;
		cursor: pointer;
		font-size: 16px;
		opacity: 0.65;
	}
	.attach:hover {
		opacity: 1;
		background: var(--bg-hover);
	}
	/* Hidden, but still a stop for the keyboard: `display: none` took the file
	   input out of the tab order, and its label cannot take focus in its place
	   — attaching an image was mouse-only. */
	.attach input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.attach:focus-within {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.prompt-btn {
		line-height: 1;
	}
	.prompt-btn.on {
		opacity: 1;
		background: var(--bg-hover);
	}
	/* Sending is the positive action of this screen, so it wears the second
	   accent rather than the first. */
	.send {
		flex: 0 0 auto;
		width: 38px;
		height: 38px;
		border-radius: 50%;
		background: var(--accent-2);
		color: var(--accent-2-ink);
		font-size: 16px;
		line-height: 1;
	}
	.send:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.send.stop {
		background: var(--bg-hover);
		color: var(--text-muted);
		font-size: 11px;
	}
	.attachments {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
		padding: 4px 4px 9px;
	}
	.att {
		position: relative;
	}
	.att img {
		width: 58px;
		height: 58px;
		object-fit: cover;
		border-radius: var(--radius-card);
		border: 1px solid var(--border);
	}
	.att button {
		position: absolute;
		top: -6px;
		right: -6px;
		width: 19px;
		height: 19px;
		font-size: 10px;
		border-radius: 50%;
		background: var(--bg);
		border: 1px solid var(--border);
		color: var(--text-muted);
	}
	.notice {
		margin: 0 4px 8px;
		padding: 7px 12px;
		font-size: 12.5px;
		border-radius: var(--radius-card);
		background: var(--accent-soft);
		color: var(--text-muted);
	}
	.palette {
		position: absolute;
		left: 8px;
		right: 8px;
		bottom: calc(100% + 8px);
		display: flex;
		flex-direction: column;
		max-height: 260px;
		overflow-y: auto;
		padding: 6px;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow);
	}
	.palette button {
		display: flex;
		gap: 10px;
		align-items: baseline;
		padding: 9px 12px;
		border-radius: 10px;
		text-align: left;
	}
	.palette button.sel,
	.palette button:hover {
		background: var(--bg-hover);
	}
	/* Saved prompts ------------------------------------------------------- */
	.pscrim {
		position: fixed;
		inset: 0;
		z-index: 5;
	}
	.palette.prompts {
		z-index: 6;
		max-height: min(340px, 55vh);
	}
	.p-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 8px 6px;
		font-size: 12px;
		color: var(--text-faint);
	}
	.palette .p-x {
		padding: 0 4px;
		color: var(--text-faint);
	}
	.palette .p-save {
		display: block;
		width: 100%;
		font-size: 13px;
		color: var(--accent);
	}
	.palette .p-save:disabled {
		opacity: 0.5;
	}
	.p-filter {
		margin: 4px 6px 2px;
		padding: 8px 12px;
		background: var(--bg-sunken);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-pill);
		font-size: 13px;
	}
	.p-list {
		overflow-y: auto;
	}
	.p-row {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.palette .p-use {
		flex: 1;
		min-width: 0;
		flex-direction: column;
		gap: 2px;
		align-items: stretch;
	}
	.p-title {
		font-size: 13.5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.p-body {
		font-size: 12px;
		color: var(--text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.palette .p-del {
		flex: 0 0 auto;
		padding: 6px 8px;
		font-size: 11px;
		color: var(--text-faint);
	}
	.palette .p-del:hover {
		color: var(--danger);
	}
	.p-none {
		margin: 0;
		padding: 12px 10px;
		font-size: 12.5px;
		color: var(--text-faint);
	}
	.p-fail {
		color: var(--danger);
	}
	.palette .p-retry {
		display: block;
		width: 100%;
		font-size: 13px;
		color: var(--accent);
	}
	.sk-name {
		flex: 0 0 auto;
		font-family: ui-monospace, Menlo, monospace;
		font-size: 13px;
		color: var(--accent);
	}
	.sk-desc {
		flex: 1;
		min-width: 0;
		font-size: 12.5px;
		color: var(--text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
