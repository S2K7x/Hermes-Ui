<script lang="ts">
	import { chat } from '$lib/stores/chat.svelte';
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

	async function submit() {
		if (chat.streaming) return;
		const payload = text;
		const files = attachments;
		if (!payload.trim() && files.length === 0) return;
		text = '';
		attachments = [];
		paletteOpen = false;
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

	{#if paletteOpen && paletteMatches.length}
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
				onchange={(e) => {
					const input = e.currentTarget;
					if (input.files) addFiles(input.files);
					input.value = '';
				}}
			/>
		</label>

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
		border-radius: 16px;
		box-shadow: var(--shadow);
	}
	.composer.dragging {
		border-color: var(--accent);
		background: var(--accent-soft);
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
		padding: 5px 7px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 16px;
		opacity: 0.65;
	}
	.attach:hover {
		opacity: 1;
		background: var(--bg-hover);
	}
	.attach input {
		display: none;
	}
	.send {
		flex: 0 0 auto;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--accent);
		color: #fff;
		font-size: 16px;
		line-height: 1;
	}
	.send:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.send.stop {
		background: var(--text-muted);
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
		border-radius: 8px;
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
		padding: 6px 10px;
		font-size: 12.5px;
		border-radius: 8px;
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
		padding: 5px;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: var(--shadow);
	}
	.palette button {
		display: flex;
		gap: 10px;
		align-items: baseline;
		padding: 7px 10px;
		border-radius: 8px;
		text-align: left;
	}
	.palette button.sel,
	.palette button:hover {
		background: var(--bg-hover);
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
