import assert from 'node:assert/strict';
import test from 'node:test';
import {
	clip,
	foldAccents,
	includesFolded,
	oneLine,
	searchNeedle,
	slugify
} from '../src/lib/text.ts';
import { matchesQuery } from '../src/lib/sessions.ts';
import { matchPrompts } from '../src/lib/prompts.ts';
import { pickModels } from '../src/lib/models.ts';
import { filterProviderGroups } from '../src/lib/providers.ts';
import { groupSkillFiles } from '../src/lib/skills.ts';
import { agentSlug } from '../src/lib/agents.ts';
import { slugifySkillName } from '../src/lib/skills.ts';
import type { HermesSession } from '../src/lib/types.ts';

test('foldAccents lowercases and drops combining marks', () => {
	assert.equal(foldAccents('Résumé'), 'resume');
	assert.equal(foldAccents('DÉPLOIEMENT'), 'deploiement');
	assert.equal(foldAccents('Où ça ? À Nîmes.'), 'ou ca ? a nimes.');
	// Already folded text is left exactly as it is.
	assert.equal(foldAccents('plain ascii 123'), 'plain ascii 123');
	assert.equal(foldAccents(foldAccents('Crème')), foldAccents('Crème'));
});

test('searchNeedle trims, so a half-typed query is not a filter of its own', () => {
	assert.equal(searchNeedle('  Modèle  '), 'modele');
	assert.equal(searchNeedle('   '), '');
	assert.equal(searchNeedle(''), '');
});

test('includesFolded ignores case and accents, and says no to a missing field', () => {
	assert.equal(includesFolded('Résumé du déploiement', 'resume'), true);
	assert.equal(includesFolded('resume', 'résumé'.normalize('NFC')), false, 'the needle is folded by the caller');
	assert.equal(includesFolded('Résumé', searchNeedle('RÉSUMÉ')), true);
	assert.equal(includesFolded('anything', ''), true, 'no needle means no filter');
	assert.equal(includesFolded(null, 'a'), false);
	assert.equal(includesFolded(undefined, 'a'), false);
	assert.equal(includesFolded('', 'a'), false);
});

test('clip marks the cut and never exceeds the bound', () => {
	assert.equal(clip('court', 10), 'court');
	assert.equal(clip('0123456789', 10), '0123456789');
	assert.equal(clip('0123456789x', 10), '012345678…');
	assert.equal(clip('0123456789x', 10).length, 10);
});

test('oneLine collapses every run of whitespace, newlines included', () => {
	assert.equal(oneLine('  deux   mots \n\t suivants  '), 'deux mots suivants');
	assert.equal(oneLine('\n\n'), '');
});

test('slugify folds accents rather than dropping the letters', () => {
	assert.equal(slugify("Résumé d'articles", 64), 'resume-d-articles');
	assert.equal(slugify('Ma Veille Tech', 64), 'ma-veille-tech');
	assert.equal(slugify('  --Trim--  ', 64), 'trim');
	assert.equal(slugify('a/b/c', 64), 'a-b-c');
	assert.equal(slugify('!!!', 64), '');
	// The length cut can land on a separator; the trailing dash goes too.
	assert.equal(slugify('abcde fghij', 6), 'abcde');
	assert.equal(slugify('x'.repeat(100), 32), 'x'.repeat(32));
});

test('both slug makers are that one rule', () => {
	assert.equal(slugifySkillName("Résumé d'articles"), 'resume-d-articles');
	assert.equal(agentSlug('Chef d’équipe', 'ab12'), 'chef-d-equipe-ab12');
	assert.equal(agentSlug('🙂', 'ab12'), 'agent-ab12');
});

// ---------------------------------------------------------------------------
// The point of the module: one rule, in every box the app offers to search.
// ---------------------------------------------------------------------------

const session = (over: Partial<HermesSession> = {}): HermesSession =>
	({
		id: 's1',
		title: 'Résumé du déploiement',
		preview: '',
		started_at: 0,
		last_active: 0,
		...over
	}) as HermesSession;

test('every search box in the app folds accents the same way', () => {
	// The sidebar and the command palette's conversation group.
	assert.equal(matchesQuery(session(), 'resume'), true);
	assert.equal(matchesQuery(session(), '  DEPLOIEMENT '), true);

	// The saved-prompt library.
	const prompts = [{ id: 'p1', title: 'Résumé', text: 'Fais un résumé.', created_at: 0 }];
	assert.equal(matchPrompts(prompts, 'resume').length, 1);

	// The model picker.
	const entries = [
		{ provider: 'op', providerName: 'Opérateur', model: 'a/b', price: null, free: false }
	];
	assert.equal(pickModels(entries, 'operateur', 10).shown.length, 1);

	// The provider search.
	const groups = [
		{
			provider: 'demo',
			label: 'Démo',
			keys: [{ key: 'DEMO_API_KEY', description: 'Clé', url: null, isSet: false, redacted: null }]
		}
	];
	assert.equal(filterProviderGroups(groups, 'demo').length, 1);

	// The skills list.
	const files = [
		{ category: 'Créatif', skill: 'résumé-auto', file: 'SKILL.md' as const, size: 1, modified: 0 }
	];
	assert.equal(groupSkillFiles(files, 'creatif').length, 1);
	assert.equal(groupSkillFiles(files, 'resume').length, 1);
});
