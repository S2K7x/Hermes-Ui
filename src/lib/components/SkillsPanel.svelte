<script lang="ts">
	import { skillsStore } from '$lib/stores/skills.svelte';
	import { relativeTime } from '$lib/sessions';
	import {
		DESCRIPTION_FILE,
		MAX_SKILL_BYTES,
		formatBytes,
		groupSkillFiles,
		isValidSkillName,
		skillKey,
		slugifySkillName,
		utf8Length,
		type SkillRef
	} from '$lib/skills';

	interface Props {
		open: boolean;
		onclose: () => void;
	}
	let { open, onclose }: Props = $props();

	let query = $state('');
	let creating = $state(false);
	let newCategory = $state('');
	let newName = $state('');
	let newDescription = $state('');
	let submitting = $state(false);

	// Load once per opening: the listing stats ~80 files, which is not
	// something to repeat on a Pi while the panel merely sits there.
	$effect(() => {
		if (open && skillsStore.available === null) skillsStore.refresh();
	});

	let groups = $derived(groupSkillFiles(skillsStore.entries, query));
	let bytes = $derived(utf8Length(skillsStore.content));
	let overLimit = $derived(bytes > MAX_SKILL_BYTES);

	function isSelected(ref: SkillRef): boolean {
		return !!skillsStore.selected && skillKey(skillsStore.selected) === skillKey(ref);
	}

	/** Never drop edits on a click — ask, the way a text editor would. */
	function guard(): boolean {
		if (!skillsStore.dirty) return true;
		return confirm('Des modifications ne sont pas enregistrées. Les abandonner ?');
	}

	function pick(ref: SkillRef) {
		if (!guard()) return;
		creating = false;
		skillsStore.open(ref);
	}

	function startCreate() {
		if (!guard()) return;
		skillsStore.close();
		creating = true;
		newCategory = skillsStore.categories[0] ?? '';
		newName = '';
		newDescription = '';
	}

	let slug = $derived(slugifySkillName(newName));
	let categorySlug = $derived(slugifySkillName(newCategory));
	let canCreate = $derived(
		!submitting && isValidSkillName(slug) && isValidSkillName(categorySlug)
	);

	async function submitCreate() {
		if (!canCreate) return;
		submitting = true;
		const ok = await skillsStore.create(categorySlug, slug, newDescription.trim());
		submitting = false;
		if (ok) creating = false;
	}

	function tryClose() {
		if (!guard()) return;
		skillsStore.close();
		creating = false;
		onclose();
	}

	function onKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			tryClose();
		} else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
			event.preventDefault();
			if (skillsStore.dirty && !overLimit) skillsStore.save();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="scrim" onclick={tryClose}></div>
	<div class="panel" role="dialog" aria-modal="true" aria-label="Skills">
		<header>
			<h2>Skills</h2>
			<span class="muted small">
				{#if skillsStore.available === false}
					indisponible
				{:else}
					fichiers sur le Pi · un redémarrage du gateway peut être nécessaire
				{/if}
			</span>
			<button class="x" onclick={tryClose} aria-label="Fermer">✕</button>
		</header>

		{#if skillsStore.available === false}
			<div class="unavailable">
				<p>L'édition des skills est désactivée.</p>
				<p class="muted small">
					Le répertoire des skills n'est pas monté dans le conteneur. Ajoutez le volume
					<code>/skills</code> et la variable <code>SKILLS_DIR</code> (voir
					<code>docker-compose.yml</code>), puis relancez <code>docker compose up -d</code>.
				</p>
			</div>
		{:else}
			<div class="split">
				<aside>
					<div class="tools">
						<input
							bind:value={query}
							placeholder="Filtrer…"
							aria-label="Filtrer les skills"
							type="search"
						/>
						<button class="new" onclick={startCreate}>＋ Nouveau</button>
					</div>

					<div class="list">
						{#if skillsStore.loading && skillsStore.entries.length === 0}
							<p class="none">Chargement…</p>
						{:else if groups.length === 0}
							<p class="none">Aucun skill.</p>
						{/if}

						{#each groups as group (group.category)}
							<div class="group">
								<div class="cat">
									<span class="cat-name">{group.category}</span>
									{#if group.description}
										<button
											class="desc"
											class:sel={isSelected(group.description)}
											title="Modifier la description de la catégorie"
											onclick={() =>
												pick({
													category: group.category,
													skill: null,
													file: DESCRIPTION_FILE
												})}>description</button
										>
									{/if}
								</div>
								{#each group.skills as entry (skillKey(entry))}
									<button
										class="row"
										class:sel={isSelected(entry)}
										onclick={() => pick(entry)}
									>
										<span class="label">{entry.skill}</span>
										<span class="meta">{formatBytes(entry.size)}</span>
										<span class="meta">{relativeTime(entry.modified)}</span>
									</button>
								{/each}
							</div>
						{/each}
					</div>
				</aside>

				<section class="editor">
					{#if creating}
						<div class="form">
							<h3>Nouveau skill</h3>
							<label>
								Catégorie
								<input
									bind:value={newCategory}
									list="skill-categories"
									placeholder="productivity"
								/>
							</label>
							<datalist id="skill-categories">
								{#each skillsStore.categories as category (category)}
									<option value={category}></option>
								{/each}
							</datalist>
							<label>
								Nom du skill
								<input bind:value={newName} placeholder="ma-veille-tech" />
							</label>
							<label>
								Description (une phrase : quand Hermes doit s'en servir)
								<input bind:value={newDescription} placeholder="Optionnel" />
							</label>
							<p class="muted small">
								Sera créé dans
								<code>{categorySlug || '<catégorie>'}/{slug || '<nom>'}/SKILL.md</code>
								{#if !skillsStore.categories.includes(categorySlug) && categorySlug}
									· nouvelle catégorie, avec son <code>DESCRIPTION.md</code>
								{/if}
							</p>
							<div class="actions">
								<button onclick={() => (creating = false)}>Annuler</button>
								<button class="primary" disabled={!canCreate} onclick={submitCreate}>
									{submitting ? 'Création…' : 'Créer'}
								</button>
							</div>
						</div>
					{:else if skillsStore.selected}
						<div class="edit-head">
							<div class="path">
								<code
									>{skillsStore.selected.category}{skillsStore.selected.skill
										? '/' + skillsStore.selected.skill
										: ''}/{skillsStore.selected.file}</code
								>
								{#if skillsStore.dirty}<span class="dot" title="Non enregistré">●</span>{/if}
							</div>
							<span class="muted small" class:over={overLimit}>
								{skillsStore.content.length} caractères · {formatBytes(bytes)}
							</span>
						</div>

						{#if skillsStore.loadingFile}
							<p class="none">Chargement…</p>
						{:else}
							<textarea
								bind:value={skillsStore.content}
								spellcheck="false"
								aria-label="Contenu du fichier"
							></textarea>
						{/if}

						<div class="edit-foot">
							<span class="muted small">
								{#if skillsStore.savedOnce}
									Enregistré sur le disque. Un nouveau skill n'est pris en compte qu'après
									<code>systemctl --user restart hermes-gateway</code>.
								{:else}
									Écriture directe dans le fichier. ⌘/Ctrl + S enregistre.
								{/if}
							</span>
							<button
								class="primary"
								disabled={!skillsStore.dirty || skillsStore.saving || overLimit}
								onclick={() => skillsStore.save()}
							>
								{skillsStore.saving ? 'Enregistrement…' : 'Enregistrer'}
							</button>
						</div>
					{:else}
						<p class="none">Choisissez un skill à gauche, ou créez-en un.</p>
					{/if}
				</section>
			</div>
		{/if}
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 150;
		background: var(--scrim);
	}
	.panel {
		position: fixed;
		z-index: 151;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(1080px, calc(100vw - 20px));
		height: min(88vh, calc(100dvh - 20px));
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		box-shadow: var(--shadow);
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border-soft);
	}
	h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
	}
	h3 {
		margin: 0 0 4px;
		font-size: 14px;
		font-weight: 600;
	}
	header .muted {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.x {
		color: var(--text-faint);
		padding: 2px 6px;
	}
	.unavailable {
		padding: 26px 20px;
		text-align: center;
	}
	.unavailable p {
		margin: 0 auto 8px;
		max-width: 460px;
	}
	.split {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	aside {
		width: 288px;
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--border-soft);
		min-height: 0;
	}
	.tools {
		display: flex;
		gap: 6px;
		padding: 10px;
		border-bottom: 1px solid var(--border-soft);
	}
	.tools input {
		flex: 1;
		min-width: 0;
		padding: 6px 9px;
		background: var(--bg-sunken);
		border: 1px solid var(--border-soft);
		border-radius: 7px;
		font-size: 13px;
		outline: none;
	}
	.new {
		flex: 0 0 auto;
		padding: 6px 10px;
		border: 1px solid var(--border);
		border-radius: 7px;
		font-size: 13px;
	}
	.new:hover {
		background: var(--bg-hover);
	}
	.list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
	}
	.group {
		margin-bottom: 10px;
	}
	.cat {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 4px 8px;
	}
	.cat-name {
		flex: 1;
		min-width: 0;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.desc {
		flex: 0 0 auto;
		font-size: 11px;
		color: var(--text-faint);
		text-decoration: underline;
	}
	.desc:hover,
	.desc.sel {
		color: var(--text);
	}
	.row {
		display: flex;
		align-items: baseline;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		border-radius: 7px;
		text-align: left;
		font-size: 13.5px;
	}
	.row:hover {
		background: var(--bg-hover);
	}
	.row.sel {
		background: var(--bg-hover);
		color: var(--text);
	}
	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		flex: 0 0 auto;
		font-size: 11px;
		color: var(--text-faint);
	}
	.editor {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.edit-head,
	.edit-foot {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 14px;
	}
	.edit-head {
		border-bottom: 1px solid var(--border-soft);
	}
	.edit-foot {
		border-top: 1px solid var(--border-soft);
	}
	.edit-foot .muted {
		flex: 1;
		min-width: 0;
	}
	.path {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 6px;
		overflow: hidden;
	}
	.path code {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12.5px;
	}
	.dot {
		flex: 0 0 auto;
		color: var(--accent);
		font-size: 10px;
	}
	textarea {
		flex: 1;
		min-height: 0;
		width: 100%;
		padding: 14px;
		background: var(--bg);
		border: none;
		resize: none;
		outline: none;
		color: var(--text);
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 13px;
		line-height: 1.55;
		tab-size: 2;
	}
	.form {
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 520px;
	}
	.form label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12.5px;
		color: var(--text-muted);
	}
	.form input {
		padding: 7px 10px;
		background: var(--bg-sunken);
		border: 1px solid var(--border-soft);
		border-radius: 7px;
		font-size: 13.5px;
		color: var(--text);
		outline: none;
	}
	.form input:focus {
		border-color: var(--border);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.actions button,
	.edit-foot button {
		padding: 6px 13px;
		border: 1px solid var(--border);
		border-radius: 7px;
		font-size: 13px;
	}
	.actions button:hover:not(:disabled),
	.edit-foot button:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	button.primary:not(:disabled) {
		background: var(--bg-sunken);
		font-weight: 600;
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.muted {
		color: var(--text-muted);
	}
	.small {
		font-size: 12px;
	}
	.over {
		color: var(--danger);
	}
	.none {
		padding: 24px;
		text-align: center;
		color: var(--text-faint);
		font-size: 13px;
	}
	code {
		padding: 1px 5px;
		background: var(--bg-sunken);
		border-radius: 4px;
		font-size: 11.5px;
	}

	@media (max-width: 820px) {
		.split {
			flex-direction: column;
		}
		aside {
			width: auto;
			border-right: none;
			border-bottom: 1px solid var(--border-soft);
			max-height: 38%;
		}
		.editor {
			min-height: 0;
		}
	}

	/* Phone: come up from the bottom edge instead of floating in the middle,
	   rounded on top only. Margins on a 390px screen are lost width. */
	@media (max-width: 820px) {
		.panel {
			top: auto;
			bottom: 0;
			left: 0;
			transform: none;
			width: 100%;
			max-height: 92dvh;
			border-radius: var(--radius-panel) var(--radius-panel) 0 0;
			border-bottom: none;
			padding-bottom: env(safe-area-inset-bottom);
		}
	}
</style>
