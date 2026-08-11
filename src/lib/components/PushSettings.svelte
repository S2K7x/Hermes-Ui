<script lang="ts">
	import { push } from '$lib/stores/push.svelte';
	import { pushServiceName } from '$lib/push';

	// The status panel is the only thing that renders this, and it refreshes on
	// open; init() is idempotent so a second open costs one GET.
	$effect(() => {
		void push.init();
	});

	function when(seconds: number | null): string {
		if (!seconds) return 'jamais';
		return new Date(seconds * 1000).toLocaleDateString('fr-FR', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<h3>Notifications</h3>

{#if !push.loaded}
	<p class="muted small note">Chargement…</p>
{:else if !push.available}
	<p class="muted small note">
		Non configuré sur le serveur : renseignez <code>VAPID_PUBLIC_KEY</code>,
		<code>VAPID_PRIVATE_KEY</code> et <code>VAPID_SUBJECT</code>.
	</p>
{:else if !push.supported}
	<p class="muted small note">Ce navigateur ne gère pas les notifications Web Push.</p>
{:else if push.needsInstall}
	<p class="muted small note">
		Sur iPhone, les notifications ne fonctionnent qu'une fois l'app ajoutée à l'écran d'accueil :
		bouton Partager → « Sur l'écran d'accueil », puis rouvrez Hermes depuis l'icône.
	</p>
{:else if push.permission === 'denied'}
	<p class="muted small note">
		Notifications refusées pour cette app. Réautorisez-les dans les réglages du système ou du
		navigateur, puis revenez ici.
	</p>
{:else}
	<div class="row">
		{#if push.enabled}
			<button class="ghost" disabled={push.busy} onclick={() => push.disable()}>
				Désactiver sur cet appareil
			</button>
			<button class="ghost" disabled={push.busy} onclick={() => push.test()}>
				Envoyer un test
			</button>
		{:else}
			<button class="primary" disabled={push.busy} onclick={() => push.enable()}>
				Activer sur cet appareil
			</button>
		{/if}
	</div>
	<p class="muted small note">
		Prévient quand un tour se termine alors que l'app n'est pas à l'écran. Les réponses des tâches
		planifiées et de Telegram ne passent pas par ici.
	</p>
{/if}

{#if push.devices.length}
	<ul class="checks">
		{#each push.devices as device (device.id)}
			<li>
				<span>{device.id === push.thisDeviceId ? '📱' : '💤'}</span>
				<span class="name">
					{device.label}{device.id === push.thisDeviceId ? ' · cet appareil' : ''}
					<span class="muted small block">
						{pushServiceName(device.host)} · dernier envoi {when(device.last_ok_at)}
						{#if device.last_error}· ⚠️ {device.last_error}{/if}
					</span>
				</span>
				<button class="x" onclick={() => push.remove(device.id)} aria-label="Retirer {device.label}"
					>✕</button
				>
			</li>
		{/each}
	</ul>
{/if}

<style>
	h3 {
		margin: 18px 0 6px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
	.note {
		margin: 4px 0 0;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 6px 0 0;
	}
	.row button {
		padding: 5px 12px;
		border: 1px solid var(--border);
		border-radius: 10px;
		font-size: 13px;
	}
	.row button:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.row button:disabled {
		opacity: 0.5;
	}
	.primary {
		border-color: var(--accent) !important;
		color: var(--accent);
	}
	.checks {
		margin: 8px 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.checks li {
		display: flex;
		align-items: baseline;
		gap: 9px;
		padding: 5px 8px;
		border-radius: 10px;
		font-size: 13.5px;
	}
	.checks li:nth-child(odd) {
		background: var(--bg-sunken);
	}
	.name {
		flex: 1;
		min-width: 0;
	}
	.block {
		display: block;
	}
	.muted {
		color: var(--text-muted);
	}
	.small {
		font-size: 12px;
	}
	.x {
		color: var(--text-faint);
		padding: 2px 6px;
	}
	.x:hover {
		color: var(--danger);
	}
	code {
		font-size: 11.5px;
		padding: 1px 5px;
		background: var(--bg-sunken);
		border-radius: 4px;
	}
</style>
