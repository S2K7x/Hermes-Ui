import assert from 'node:assert/strict';
import test from 'node:test';
import {
	SCHEDULE_PRESETS,
	humanMinutes,
	jobState,
	nextRunLabel,
	parseDuration,
	parseSchedule,
	scheduleDisplay,
	sortJobs,
	targetLabel,
	usableTargets
} from '../src/lib/jobs.ts';
import type { HermesJob } from '../src/lib/types.ts';

// A fixed clock so "dans 30 min" never depends on when the suite runs.
const NOW = new Date(2026, 7, 10, 9, 0, 0); // 10 August 2026, 09:00 local

// ---------------------------------------------------------------------------
// parseDuration — mirrors cron/jobs.py::parse_duration
// ---------------------------------------------------------------------------

test('parseDuration accepts every unit spelling upstream accepts', () => {
	assert.equal(parseDuration('30m'), 30);
	assert.equal(parseDuration('30 minutes'), 30);
	assert.equal(parseDuration('2h'), 120);
	assert.equal(parseDuration('2 hours'), 120);
	assert.equal(parseDuration('1d'), 1440);
	assert.equal(parseDuration(' 3 DAYS '), 4320);
});

test('parseDuration rejects what upstream rejects', () => {
	assert.equal(parseDuration('soon'), null);
	assert.equal(parseDuration('30'), null);
	assert.equal(parseDuration('m30'), null);
	assert.equal(parseDuration('1.5h'), null);
	assert.equal(parseDuration('-2h'), null);
	// A zero duration parses upstream but would schedule nothing useful.
	assert.equal(parseDuration('0m'), null);
});

test('humanMinutes keeps round values readable', () => {
	assert.equal(humanMinutes(30), '30 min');
	assert.equal(humanMinutes(120), '2 h');
	assert.equal(humanMinutes(1440), '1 j');
	assert.equal(humanMinutes(90), '1 h 30');
});

// ---------------------------------------------------------------------------
// parseSchedule — the guard rail in front of an upstream 500
// ---------------------------------------------------------------------------

test('parseSchedule classifies the four accepted forms', () => {
	assert.equal(parseSchedule('30m', NOW).kind, 'once');
	assert.equal(parseSchedule('every 30m', NOW).kind, 'interval');
	assert.equal(parseSchedule('0 9 * * *', NOW).kind, 'cron');
	assert.equal(parseSchedule('2026-12-31T23:59', NOW).kind, 'once');
});

test('parseSchedule follows the upstream precedence: "every" wins over cron', () => {
	// "every 5 * * * *" starts with "every ", so upstream never reaches the
	// cron branch — and its duration is unparseable.
	assert.equal(parseSchedule('every 5 * * * *', NOW).kind, null);
});

test('parseSchedule previews a relative one-shot against the given clock', () => {
	const parsed = parseSchedule('2h', NOW);
	assert.equal(parsed.kind, 'once');
	assert.match(parsed.display, /dans 2 h/);
	assert.equal(parsed.error, '');
});

test('parseSchedule rejects an empty or unreadable schedule', () => {
	assert.equal(parseSchedule('', NOW).kind, null);
	assert.equal(parseSchedule('   ', NOW).kind, null);
	assert.equal(parseSchedule('chaque matin', NOW).kind, null);
	assert.ok(parseSchedule('chaque matin', NOW).error.length > 0);
});

test('parseSchedule rejects out-of-range cron fields croniter would refuse', () => {
	assert.equal(parseSchedule('0 25 * * *', NOW).kind, null);
	assert.equal(parseSchedule('60 9 * * *', NOW).kind, null);
	assert.equal(parseSchedule('0 9 32 * *', NOW).kind, null);
	assert.equal(parseSchedule('0 9 * 13 *', NOW).kind, null);
	assert.equal(parseSchedule('0 9 * * 8', NOW).kind, null);
	// A descending range is not a range.
	assert.equal(parseSchedule('0 18-9 * * *', NOW).kind, null);
	// Step must be a positive integer.
	assert.equal(parseSchedule('*/0 * * * *', NOW).kind, null);
});

test('parseSchedule accepts the cron shapes croniter accepts', () => {
	assert.equal(parseSchedule('*/15 * * * *', NOW).kind, 'cron');
	assert.equal(parseSchedule('0 9-18 * * 1-5', NOW).kind, 'cron');
	assert.equal(parseSchedule('0 8,12,20 * * *', NOW).kind, 'cron');
	assert.equal(parseSchedule('0 0 1 1 0', NOW).kind, 'cron');
	// Six fields (the optional year) still reads as cron upstream.
	assert.equal(parseSchedule('0 9 * * * 2027', NOW).kind, 'cron');
});

test('parseSchedule refuses a timestamp in the past, which upstream rejects too', () => {
	assert.equal(parseSchedule('2020-01-01T09:00', NOW).kind, null);
	assert.match(parseSchedule('2020-01-01T09:00', NOW).error, /passée/);
});

test('parseSchedule reads a naive timestamp as wall clock, not UTC', () => {
	// new Date("2026-08-11") would be UTC midnight; upstream reads the naive
	// form in the Hermes timezone, so the preview must stay on local time.
	const parsed = parseSchedule('2026-08-11', NOW);
	assert.equal(parsed.kind, 'once');
	assert.match(parsed.display, /11/);
});

test('every schedule preset is something the schedule parser accepts', () => {
	for (const preset of SCHEDULE_PRESETS) {
		assert.notEqual(parseSchedule(preset.value, NOW).kind, null, preset.value);
	}
});

// ---------------------------------------------------------------------------
// Reading a job back
// ---------------------------------------------------------------------------

test('scheduleDisplay never leaks the schedule object', () => {
	assert.equal(scheduleDisplay({} as HermesJob), '—');
	assert.notEqual(scheduleDisplay({ schedule: { kind: 'once' } }), '[object Object]');
	assert.notEqual(scheduleDisplay({ schedule: { kind: 'nouveau', size: 3 } }), '[object Object]');
});

test('scheduleDisplay prefers the structured fields over the English display', () => {
	// Upstream sends `schedule_display: "every 720m"` alongside these.
	assert.equal(
		scheduleDisplay({
			schedule: { kind: 'interval', minutes: 720, display: 'every 720m' },
			schedule_display: 'every 720m'
		}),
		'toutes les 12 h'
	);
	assert.equal(
		scheduleDisplay({ schedule: { kind: 'cron', expr: '0 9 * * *' }, schedule_display: '0 9 * * *' }),
		'0 9 * * *'
	);
	assert.match(
		scheduleDisplay({
			schedule: { kind: 'once', run_at: '2026-12-31T23:59:00+03:00' },
			schedule_display: 'once at 2026-12-31 23:59'
		}),
		/^une fois, le /
	);
});

test('scheduleDisplay falls back to schedule_display for shapes it cannot read', () => {
	assert.equal(scheduleDisplay({ schedule_display: 'every 60m' }), 'every 60m');
	assert.equal(scheduleDisplay({ schedule: { kind: 'interval' } as never }), 'interval');
});

test('jobState trusts the reconciled state over the enabled flag', () => {
	// effective_job_state() upstream refuses to call an enabled job paused.
	assert.equal(jobState({ state: 'scheduled', enabled: true }).key, 'scheduled');
	assert.equal(jobState({ state: 'paused', enabled: false }).key, 'paused');
	assert.equal(jobState({ state: 'error' }).key, 'error');
	assert.equal(jobState({ state: 'completed' }).key, 'completed');
	// Records written before `state` existed fall back to `enabled`.
	assert.equal(jobState({ enabled: false }).key, 'paused');
	assert.equal(jobState({}).key, 'scheduled');
});

test('nextRunLabel switches from relative to absolute past 18 hours', () => {
	const soon = new Date(NOW.getTime() + 120 * 60_000).toISOString();
	assert.match(nextRunLabel({ next_run_at: soon }, NOW), /dans 2 h/);

	const later = new Date(NOW.getTime() + 40 * 3600_000).toISOString();
	assert.doesNotMatch(nextRunLabel({ next_run_at: later }, NOW), /dans/);

	assert.equal(nextRunLabel({}, NOW), '');
	assert.equal(nextRunLabel({ next_run_at: null }, NOW), '');
	assert.equal(nextRunLabel({ next_run_at: 'pas une date' }, NOW), '');
});

test('sortJobs puts runnable jobs first, soonest first, undated last', () => {
	const at = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();
	const jobs: HermesJob[] = [
		{ id: 'c', state: 'paused', next_run_at: at(1) },
		{ id: 'b', state: 'scheduled', next_run_at: null },
		{ id: 'a', state: 'scheduled', next_run_at: at(3) },
		{ id: 'z', state: 'scheduled', next_run_at: at(1) }
	];
	assert.deepEqual(
		sortJobs(jobs).map((j) => j.id),
		['z', 'a', 'b', 'c']
	);
	// Pure: the input order is untouched.
	assert.equal(jobs[0].id, 'c');
});

// ---------------------------------------------------------------------------
// Delivery targets
// ---------------------------------------------------------------------------

test('usableTargets drops platforms with no configured home channel', () => {
	const targets = usableTargets([
		{ id: 'local', name: 'Local (save only)', home_target_set: true },
		{ id: 'telegram', name: 'Telegram', home_target_set: true },
		{ id: 'slack', name: 'Slack', home_target_set: false }
	]);
	assert.deepEqual(
		targets.map((t) => t.id),
		['local', 'telegram']
	);
});

test('targetLabel translates the local choice and passes platforms through', () => {
	// Upstream calls it "Local (save only)".
	assert.equal(targetLabel({ id: 'local', name: 'Local (save only)' }), 'Local (enregistré seulement)');
	assert.equal(targetLabel({ id: 'telegram', name: 'Telegram' }), 'Telegram');
	assert.equal(targetLabel({ id: 'matrix' }), 'matrix');
});

test('usableTargets always keeps a local choice, even from an empty list', () => {
	assert.deepEqual(
		usableTargets([]).map((t) => t.id),
		['local']
	);
	assert.deepEqual(
		usableTargets([{ id: 'telegram', home_target_set: true }]).map((t) => t.id),
		['local', 'telegram']
	);
});
