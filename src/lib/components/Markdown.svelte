<script lang="ts">
	import {
		hasCodeBlocks,
		highlightCodeBlocks,
		highlighterReady,
		loadHighlighter,
		RENDER_DEBOUNCE_MS,
		renderMarkdown
	} from '$lib/markdown';
	import { onDestroy, tick } from 'svelte';

	interface Props {
		source: string;
		streaming?: boolean;
	}
	let { source, streaming = false }: Props = $props();

	let html = $state('');
	let container = $state<HTMLDivElement | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;

	/** Set once the grammar bundle has been asked for, so the scan below stops. */
	let warmed = false;

	function render() {
		html = renderMarkdown(source, streaming);
		// A fence has appeared mid-stream: start fetching the grammar bundle now
		// so it is resident when the turn ends, instead of flashing plain code
		// first. Checked here rather than per token — this runs on the debounce.
		if (streaming && !warmed && source.includes('```')) {
			warmed = true;
			loadHighlighter();
		}
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

	// Syntax highlighting and copy buttons, only once the message is final —
	// decorating a growing block redoes the work on every pass for nothing.
	//
	// The `tick()` is not cosmetic. `html` is assigned from inside the effect
	// above, so when this effect body runs Svelte has not yet written
	// `{@html html}` to the DOM: touching `container` here would decorate the
	// *previous* markup, which the pending swap then throws away. That is why
	// neither highlighting nor the copy button ever appeared (verified against
	// the live app: a transcript with 13 code blocks had zero `.hljs-*` spans
	// and zero buttons). Post-processing has to wait for the flush.
	$effect(() => {
		void html;
		if (streaming || !container) return;
		const root = container;
		let cancelled = false;
		const alive = () => !cancelled && root.isConnected;
		void (async () => {
			await tick();
			if (!alive()) return;
			decorateCodeBlocks(root);
			if (!hasCodeBlocks(root)) return;
			// Nothing to await once the grammars are resident — the common case
			// after the first code block, and the one that must not flash.
			if (!highlighterReady()) await loadHighlighter();
			if (alive()) highlightCodeBlocks(root);
		})();
		return () => {
			cancelled = true;
		};
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
