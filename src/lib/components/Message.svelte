<script lang="ts">
	import Icon from './Icon.svelte';
	import Markdown from './Markdown.svelte';
	import ToolSteps from './ToolSteps.svelte';
	import type { UiMessage } from '$lib/transcript';

	interface Props {
		message: UiMessage;
		/** Briefly outlined, after the palette jumped the thread to it. */
		flash?: boolean;
		onfork?: () => void;
		onreload?: () => void;
		onresend?: () => void;
	}
	let { message, flash = false, onfork, onreload, onresend }: Props = $props();

	let copied = $state(false);
	function copy() {
		navigator.clipboard.writeText(message.content);
		copied = true;
		setTimeout(() => (copied = false), 1400);
	}
</script>

<!-- `data-mid` is how the page finds this turn again when a search result is
     chosen: message ids come from Hermes and are not safe as DOM ids. -->
<article class="msg {message.role}" class:flash data-mid={message.id}>
	{#if message.role === 'user'}
		<div class="bubble">
			<!-- Read out before the text: a transcript of bare paragraphs gives
			     no clue who is speaking. Visible attribution is the layout. -->
			<span class="sr-only">Vous :</span>
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
			<span class="sr-only">Yadai :</span>
			<ToolSteps steps={message.steps} reasoning={message.reasoning} streaming={message.streaming} />

			{#if message.content}
				<div class="body" class:typing={message.streaming}>
					<Markdown source={message.content} streaming={message.streaming} />
				</div>
			{:else if message.streaming && message.steps.length === 0}
				<div class="thinking"><span></span><span></span><span></span></div>
			{/if}

			{#if message.error}
				<div class="error"><Icon name="warning" size={15} /> {message.error}</div>
			{/if}

			{#if message.detached}
				<div class="detached">
					{#if message.detached === 'truncated'}
						Le flux s'est interrompu avant la fin du tour : ce texte est incomplet. L'agent
						termine en arrière-plan et sa réponse entière sera dans la conversation.
					{:else}
						Affichage interrompu. Yadai n'expose pas d'arrêt pour ce type de tour : l'agent
						termine en arrière-plan et sa réponse sera dans la conversation.
					{/if}
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
		margin: 0 0 12px;
	}
	.msg.user {
		justify-content: flex-end;
	}
	/* Both bubbles are cards now: the thread sits on the sunken ground and
	   nothing is outlined, so a message is told apart from the page by its
	   fill and its lift. The clipped corner is what still says who is
	   speaking once both of them are cards. */
	.bubble {
		max-width: min(78%, 640px);
		padding: 13px 19px;
		background: var(--user-bubble);
		color: var(--user-ink);
		border-radius: var(--radius-bubble) var(--radius-bubble) 8px var(--radius-bubble);
		box-shadow: var(--shadow-card);
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
		border-radius: var(--radius-card);
		object-fit: cover;
	}
	/* The assistant answers in a card of its own, so the blocks a reply
	   contains (code, tables) read as insets rather than as the page. */
	.assistant {
		width: 100%;
		min-width: 0;
		padding: 16px 20px;
		background: var(--bg-raised);
		border-radius: var(--radius-bubble) var(--radius-bubble) var(--radius-bubble) 8px;
		box-shadow: var(--shadow-card);
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

	/* Where did it say that? — the palette answers with an excerpt, this says
	   where. Two and a half seconds, then the thread looks untouched again. */
	.msg.flash .bubble,
	.msg.flash .assistant {
		animation: flash 2.4s ease-out;
	}
	@keyframes flash {
		0%,
		35% {
			box-shadow: var(--shadow-card), 0 0 0 2px var(--focus);
		}
		100% {
			box-shadow: var(--shadow-card), 0 0 0 2px transparent;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.msg.flash .bubble,
		.msg.flash .assistant {
			animation-duration: 0.01s;
			box-shadow: var(--shadow-card), 0 0 0 2px var(--focus);
		}
	}

	.detached {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		margin-top: 10px;
		padding: 11px 16px;
		border-radius: var(--radius-card);
		background: var(--bg-sunken);
		color: var(--text-muted);
		font-size: 13px;
	}
	.detached button {
		padding: 7px 14px;
		border-radius: var(--radius-pill);
		background: var(--bg-raised);
		box-shadow: var(--shadow-card);
		font-size: 12.5px;
		color: var(--text);
	}
	.detached button:hover {
		background: var(--bg-hover);
	}
	.error {
		margin-top: 10px;
		padding: 11px 16px;
		border-radius: var(--radius-card);
		background: var(--danger-soft);
		color: var(--danger);
		font-size: 13.5px;
	}
	.actions {
		display: flex;
		gap: 6px;
		margin-top: 12px;
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
		padding: 6px 14px;
		font-size: 12px;
		color: var(--text-faint);
		background: var(--bg-sunken);
		border-radius: var(--radius-pill);
	}
	.actions button:hover {
		color: var(--text);
		background: var(--bg-hover);
	}
	/* Touch: these pills are always visible (there is no hover to reveal them),
	   so they are real targets and have to be thumb-sized. */
	@media (max-width: 820px) {
		.actions button {
			min-height: 44px;
			padding: 6px 16px;
		}
		.assistant {
			padding: 14px 16px;
		}
		.bubble {
			padding: 12px 16px;
		}
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
