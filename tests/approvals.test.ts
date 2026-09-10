import test from 'node:test';
import assert from 'node:assert/strict';
import { firstPendingApproval, pendingApproval } from '../src/lib/approvals.ts';

/**
 * The fixture is not invented: it is what `check_all_command_guards` actually
 * returned when called, in a gateway context with no notify callback
 * registered — the exact situation of a conversation turn. Captured against
 * Hermes 0.20.0 rather than copied from its source, so a change in the
 * upstream wording shows up here as a failing test.
 */
const REAL = [
	'⚠️ sudo with combined-flag privilege escalation. Asking the user for approval.',
	'',
	'**Command:**',
	'```',
	'sudo nmap -sS 10.100.102.1',
	'```'
].join('\n');

test('a pending approval is read out of the tool result', () => {
	assert.deepEqual(pendingApproval(REAL), {
		command: 'sudo nmap -sS 10.100.102.1',
		reason: 'sudo with combined-flag privilege escalation'
	});
});

test('a multi-line command survives intact', () => {
	const result = [
		'⚠️ recursive delete. Asking the user for approval.',
		'',
		'**Command:**',
		'```bash',
		'cd /tmp',
		'rm -rf ./build',
		'```'
	].join('\n');
	assert.equal(pendingApproval(result)?.command, 'cd /tmp\nrm -rf ./build');
});

test('an ordinary tool result is not an approval', () => {
	for (const value of [
		null,
		undefined,
		'',
		'3 hôtes actifs sur 256 adresses testées.',
		'BLOCKED: Action denied by user. Do NOT retry it.',
		'The user was asking about approval workflows.'
	]) {
		assert.equal(pendingApproval(value), null, String(value));
	}
});

/**
 * The marker without the command block means the upstream shape moved. A block
 * that cannot say *what* was blocked is worse than no block at all, so it
 * degrades to nothing rather than to a half-parse.
 */
test('the marker alone is not enough', () => {
	assert.equal(pendingApproval('⚠️ something. Asking the user for approval.'), null);
	assert.equal(pendingApproval('Asking the user for approval'), null);
});

test('a missing reason still yields the command', () => {
	const result = 'Asking the user for approval\n\n**Command:**\n```\nsudo id\n```';
	assert.deepEqual(pendingApproval(result), { command: 'sudo id', reason: '' });
});

test('the first pending step of a turn is the one reported', () => {
	const steps = [
		{ result: 'ok, 3 files' },
		{ result: null },
		{ result: REAL },
		{
			result: '⚠️ second one. Asking the user for approval.\n\n**Command:**\n```\nsudo reboot\n```'
		}
	];
	assert.equal(firstPendingApproval(steps)?.command, 'sudo nmap -sS 10.100.102.1');
	assert.equal(firstPendingApproval([{ result: 'rien' }]), null);
	assert.equal(firstPendingApproval([]), null);
});

// ---------------------------------------------------------------------------
// The policy — what the panel is allowed to write
// ---------------------------------------------------------------------------

import {
	APPROVAL_MODES,
	DEFAULT_POLICY,
	modeStrandsWebUi,
	normalizeApprovalPolicy,
	planPolicyUpdate
} from '../src/lib/approvals.ts';

/** The live shape, read from this machine's dashboard on `GET /api/config`. */
const REAL_BLOCK = {
	mode: 'smart',
	timeout: 300,
	cron_mode: 'deny',
	smart_policy: '',
	denial_breaker_threshold: 3,
	deny: [],
	mcp_reload_confirm: true,
	destructive_slash_confirm: true
};

test('the live config block is read into a policy', () => {
	assert.deepEqual(normalizeApprovalPolicy(REAL_BLOCK, []), {
		mode: 'smart',
		deny: [],
		allowlist: []
	});
});

test('an unknown mode falls back rather than being written through', () => {
	// `mode` reaches `is_approval_bypass_active_for_session` upstream. A value
	// it does not recognise must never be something this app invented.
	for (const bad of ['yolo', '', null, 42, undefined, 'OFF']) {
		assert.equal(normalizeApprovalPolicy({ mode: bad }, []).mode, DEFAULT_POLICY.mode, String(bad));
	}
	for (const mode of APPROVAL_MODES) {
		assert.equal(normalizeApprovalPolicy({ mode }, []).mode, mode);
	}
});

test('rules are trimmed, de-duplicated and bounded', () => {
	const policy = normalizeApprovalPolicy(
		{ mode: 'manual', deny: ['  git push --force*  ', 'git push --force*', '', '   ', 7] },
		['docker *', 'docker *', null]
	);
	assert.deepEqual(policy.deny, ['git push --force*']);
	assert.deepEqual(policy.allowlist, ['docker *']);
});

test('a non-list where a list belongs reads as empty, not as garbage', () => {
	assert.deepEqual(normalizeApprovalPolicy({ deny: 'git push' }, 'docker'), {
		mode: 'smart',
		deny: [],
		allowlist: []
	});
});

/**
 * The sharp edge of this panel.
 *
 * `PUT /api/config` deep-merges, and a deep merge replaces a list wholesale
 * rather than merging it element by element. Composing on a policy that was
 * never read would therefore not "fall back to the defaults" — it would erase
 * every deny rule the user wrote, and deny rules are the ones that hold even
 * under `--yolo`.
 */
test('a policy change is refused when nothing trustworthy was read', () => {
	assert.deepEqual(planPolicyUpdate(null, { mode: 'off' }), { ok: false, reason: 'unloaded' });
	assert.deepEqual(planPolicyUpdate(null, {}), { ok: false, reason: 'unloaded' });
});

test('a policy change composes on the baseline, field by field', () => {
	const base = {
		mode: 'smart' as const,
		deny: ['rm -rf /*'],
		allowlist: ['docker compose ps']
	};
	const result = planPolicyUpdate(base, { mode: 'manual' });
	assert.ok(result.ok);
	// The two lists survive a change that did not mention them.
	assert.deepEqual(result.policy, {
		mode: 'manual',
		deny: ['rm -rf /*'],
		allowlist: ['docker compose ps']
	});

	// And an explicit empty list is honoured — that is a real intent.
	const cleared = planPolicyUpdate(base, { deny: [] });
	assert.ok(cleared.ok);
	assert.deepEqual(cleared.policy.deny, []);
	assert.deepEqual(cleared.policy.allowlist, ['docker compose ps']);
});

test('a composed policy is normalised on the way out', () => {
	const result = planPolicyUpdate(DEFAULT_POLICY, {
		mode: 'nope' as never,
		deny: ['  a  ', 'a']
	});
	assert.ok(result.ok);
	assert.equal(result.policy.mode, 'smart');
	assert.deepEqual(result.policy.deny, ['a']);
});

/** Manual mode is the one that leaves this UI unable to answer its own prompts. */
test('manual mode is flagged as stranding the web UI', () => {
	assert.equal(modeStrandsWebUi('manual'), true);
	assert.equal(modeStrandsWebUi('smart'), false);
	assert.equal(modeStrandsWebUi('off'), false);
});
