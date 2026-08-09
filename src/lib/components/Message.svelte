<script lang="ts">
	import Markdown from './Markdown.svelte';
	import ToolSteps from './ToolSteps.svelte';
	import type { UiMessage } from '$lib/transcript';

	interface Props {
		message: UiMessage;
		onfork?: () => void;
		onreload?: () => void;
		onresend?: () => void;
	}
	let { message, onfork, onreload, onresend }: Props = $props();

	let copied = $state(false);
	function copy() {
		navigator.clipboard.writeText(message.content);
		copied = true;
		setTimeout(() => (copied = false), 1400);
	}
</script>

<article class="msg {message.role}">
	{#if message.role === 'user'}
		<div class="bubble">
			{#if message.images.length}
				<div class="images">
					{#each message.images as src, i (i)}
						<img {src} alt="pièce jointe {i + 1}" />
					{/each}
				</div>
			{/if}
			<div class="user-text">{message.content}</div>
		</div>
	{:else}
		<div class="assistant">
			<ToolSteps steps={message.steps} reasoning={message.reasoning} streaming={message.streaming} />

			{#if message.content}
				<div class="body" class:typing={message.streaming}>
					<Markdown source={message.content} streaming={message.streaming} />
				</div>
			{:else if message.streaming && message.steps.length === 0}
				<div class="thinking"><span></span><span></span><span></span></div>
			{/if}

			{#if message.error}
				<div class="error">⚠️ {message.error}</div>
			{/if}

			{#if message.detached}
				<div class="detached">
					Affichage interrompu. Hermes n'expose pas d'arrêt pour ce type de tour : l'agent
					termine en arrière-plan et sa réponse sera dans la conversation.
					<button onclick={onreload}>Recharger</button>
				</div>
			{/if}

			{#if !message.streaming && (message.content || message.error)}
				<div class="actions">
					{#if message.content}
						<button onclick={copy}>{copied ? 'copié' : 'copier'}</button>
					{/if}
					{#if onresend}<button onclick={onresend}>renvoyer</button>{/if}
					{#if onfork}<button onclick={onfork}>brancher ici</button>{/if}
				</div>
			{/if}
		</div>
	{/if}
</article>

<style>
	.msg {
		display: flex;
		margin: 0 0 22px;
	}
	.msg.user {
		justify-content: flex-end;
	}
	.bubble {
		max-width: min(78%, 640px);
		padding: 10px 15px;
		background: var(--user-bubble);
		border-radius: 16px 16px 4px 16px;
	}
	.user-text {
		white-space: pre-wrap;
		word-break: break-word;
	}
	.images {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.images img {
		max-width: 180px;
		max-height: 180px;
		border-radius: 8px;
		object-fit: cover;
	}
	.assistant {
		width: 100%;
		min-width: 0;
	}
	/* Blinking caret after the last rendered character, like Claude's. The
	   markdown re-render is debounced, so the caret is what tells the user
	   text is still arriving between parses. */
	.body.typing :global(> .md > :last-child::after) {
		content: '';
		display: inline-block;
		width: 2px;
		height: 1em;
		margin-left: 2px;
		vertical-align: text-bottom;
		background: var(--accent);
		animation: caret 1s steps(2) infinite;
	}
	@keyframes caret {
		0%,
		50% {
			opacity: 1;
		}
		51%,
		100% {
			opacity: 0;
		}
	}

	.detached {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		margin-top: 8px;
		padding: 8px 12px;
		border-radius: 8px;
		background: var(--bg-sunken);
		color: var(--text-muted);
		font-size: 13px;
	}
	.detached button {
		padding: 3px 10px;
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 12.5px;
		color: var(--text);
	}
	.detached button:hover {
		background: var(--bg-hover);
	}
	.error {
		margin-top: 8px;
		padding: 8px 12px;
		border-radius: 8px;
		background: rgba(224, 82, 82, 0.1);
		color: var(--danger);
		font-size: 13.5px;
	}
	.actions {
		display: flex;
		gap: 4px;
		margin-top: 8px;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.msg:hover .actions,
	.actions:focus-within {
		opacity: 1;
	}
	@media (hover: none) {
		.actions {
			opacity: 0.65;
		}
	}
	.actions button {
		padding: 3px 9px;
		font-size: 12px;
		color: var(--text-faint);
		border: 1px solid var(--border-soft);
		border-radius: 6px;
	}
	.actions button:hover {
		color: var(--text);
		background: var(--bg-hover);
	}
	.thinking {
		display: flex;
		gap: 5px;
		padding: 6px 0;
	}
	.thinking span {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--text-faint);
		animation: bounce 1.2s ease-in-out infinite;
	}
	.thinking span:nth-child(2) {
		animation-delay: 0.15s;
	}
	.thinking span:nth-child(3) {
		animation-delay: 0.3s;
	}
	@keyframes bounce {
		0%,
		60%,
		100% {
			transform: translateY(0);
			opacity: 0.4;
		}
		30% {
			transform: translateY(-4px);
			opacity: 1;
		}
	}
</style>
