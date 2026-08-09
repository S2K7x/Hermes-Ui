<script lang="ts">
	import { highlightCodeBlocks, RENDER_DEBOUNCE_MS, renderMarkdown } from '$lib/markdown';
	import { onDestroy } from 'svelte';

	interface Props {
		source: string;
		streaming?: boolean;
	}
	let { source, streaming = false }: Props = $props();

	let html = $state('');
	let container = $state<HTMLDivElement | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;

	function render() {
		html = renderMarkdown(source, streaming);
	}

	// While streaming, re-parse on a timer instead of per token: a full
	// markdown parse at frame rate saturates the Pi's CPU. When the stream
	// ends, render once immediately so the final text is never stale.
	$effect(() => {
		void source;
		if (!streaming) {
			if (timer) clearTimeout(timer);
			timer = null;
			render();
			return;
		}
		if (timer) return;
		timer = setTimeout(() => {
			timer = null;
			render();
		}, RENDER_DEBOUNCE_MS);
	});

	// Syntax highlighting only once the message is final — highlighting a
	// growing block re-colours it on every pass for nothing.
	$effect(() => {
		void html;
		if (streaming || !container) return;
		highlightCodeBlocks(container);
		decorateCodeBlocks(container);
	});

	/** Add a copy button to each finished code block. */
	function decorateCodeBlocks(root: HTMLElement) {
		for (const pre of root.querySelectorAll<HTMLPreElement>('pre:not([data-decorated])')) {
			pre.dataset.decorated = '1';
			pre.classList.add('code-wrap');
			const button = document.createElement('button');
			button.type = 'button';
			button.dataset.copy = '1';
			button.className = 'copy-btn';
			button.textContent = 'copier';
			pre.prepend(button);
		}
	}

	onDestroy(() => {
		if (timer) clearTimeout(timer);
	});

	function onCopy(event: MouseEvent) {
		const button = (event.target as HTMLElement).closest<HTMLElement>('[data-copy]');
		if (!button || !container) return;
		const code = button.closest('pre')?.querySelector('code');
		if (!code) return;
		navigator.clipboard.writeText(code.textContent ?? '');
		button.textContent = 'copié';
		setTimeout(() => (button.textContent = 'copier'), 1400);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="md" bind:this={container} onclick={onCopy}>
	{@html html}
</div>

<style>
	.md {
		word-break: break-word;
		overflow-wrap: anywhere;
	}

	.md :global(pre.code-wrap) {
		position: relative;
	}

	.md :global(.copy-btn) {
		position: absolute;
		top: 6px;
		right: 8px;
		z-index: 1;
		padding: 2px 8px;
		font-size: 11px;
		color: var(--text-faint);
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: 5px;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.md :global(pre.code-wrap:hover .copy-btn),
	.md :global(.copy-btn:focus-visible) {
		opacity: 1;
	}

	/* Touch devices have no hover; keep it permanently visible there. */
	@media (hover: none) {
		.md :global(.copy-btn) {
			opacity: 0.7;
		}
	}
</style>
