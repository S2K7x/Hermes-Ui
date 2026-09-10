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
