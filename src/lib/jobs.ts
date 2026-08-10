import type { HermesJob } from './types';

/**
 * Pure helpers for the scheduled-jobs panel.
 *
 * Everything here mirrors what `cron/jobs.py` accepts upstream so the browser
 * can refuse a bad schedule *before* posting it. That matters more than usual:
 * `POST /api/jobs` answers an invalid schedule with **HTTP 500** (measured —
 * `parse_schedule` raises ValueError and the handler's bare `except` maps it to
 * 500), so without a local check the user would face a server error for a typo.
 * Hermes stays the authority; this is only a guard rail and a preview.
 */

/** `_MAX_NAME_LENGTH` / `_MAX_PROMPT_LENGTH` in `api_server.py`. */
export const MAX_JOB_NAME = 200;
export const MAX_JOB_PROMPT = 5000;

export type ScheduleKind = 'once' | 'interval' | 'cron';

export interface ParsedSchedule {
	/** null when the input is not something Hermes would accept. */
	kind: ScheduleKind | null;
	/** French preview of when it runs. Empty when invalid. */
	display: string;
	/** French reason, when invalid. Empty otherwise. */
	error: string;
}

const INVALID_HINT =
	"Formats acceptés : « 30m », « 2h », « 1d » (une fois), « every 30m » (répété), " +
	'« 0 9 * * * » (cron) ou « 2026-08-11T09:00 » (date précise).';

const DURATION_RE = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/;

/** `parse_duration` upstream: a count plus a unit, resolved to minutes. */
export function parseDuration(input: string): number | null {
	const match = DURATION_RE.exec(input.trim().toLowerCase());
	if (!match) return null;
	const value = Number(match[1]);
	const unit = match[2][0];
	const factor = unit === 'm' ? 1 : unit === 'h' ? 60 : 1440;
	const minutes = value * factor;
	return minutes > 0 ? minutes : null;
}

/** "90" -> "1 h 30", for an interval preview. */
export function humanMinutes(minutes: number): string {
	if (minutes < 60) return `${minutes} min`;
	if (minutes % 1440 === 0) return `${minutes / 1440} j`;
	if (minutes % 60 === 0) return `${minutes / 60} h`;
	return `${Math.floor(minutes / 60)} h ${minutes % 60}`;
}

const CRON_FIELD_RE = /^[\d*\-,/]+$/;
// Inclusive bounds of the five standard cron fields, in order.
const CRON_BOUNDS: [number, number][] = [
	[0, 59],
	[0, 23],
	[1, 31],
	[1, 12],
	[0, 7]
];

/**
 * Reject the cron expressions croniter would reject upstream.
 *
 * Only the shapes `parse_schedule` can reach us with (`[\d*\-,/]+`) need
 * covering: `*`, `a`, `a-b`, comma lists and any of those with a `/step`.
 */
function cronFieldValid(field: string, min: number, max: number): boolean {
	return field.split(',').every((part) => {
		if (part === '') return false;
		const [range, step, ...rest] = part.split('/');
		if (rest.length > 0) return false;
		if (step !== undefined && !/^\d+$/.test(step)) return false;
		if (step !== undefined && Number(step) < 1) return false;
		if (range === '*') return true;
		const bounds = range.split('-');
		if (bounds.length > 2) return false;
		const numbers = bounds.map(Number);
		if (numbers.some((n) => !Number.isInteger(n) || n < min || n > max)) return false;
		if (bounds.some((b) => !/^\d+$/.test(b))) return false;
		if (numbers.length === 2 && numbers[0] > numbers[1]) return false;
		return true;
	});
}

/**
 * Local midnight-anchored parse of the naive ISO forms Hermes accepts.
 *
 * `datetime.fromisoformat` reads "2026-08-11" and "2026-08-11T09:00" as wall
 * clock in the Hermes timezone; `new Date("2026-08-11")` would read the first
 * as UTC. Building the Date from its parts keeps the preview on the same clock
 * the user typed. Anything carrying an explicit offset falls through to the
 * platform parser, which handles offsets correctly.
 */
function parseNaiveIso(input: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(input);
	if (match) {
		const [, y, mo, d, h, mi, s] = match;
		const date = new Date(
			Number(y),
			Number(mo) - 1,
			Number(d),
			Number(h ?? 0),
			Number(mi ?? 0),
			Number(s ?? 0)
		);
		return Number.isNaN(date.getTime()) ? null : date;
	}
	const date = new Date(input);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(date: Date): string {
	return date.toLocaleString('fr-FR', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});
}

/**
 * Classify a schedule string the way `parse_schedule` does, in the same order:
 * `every …` first, then a cron expression, then an ISO timestamp, then a bare
 * duration.
 */
export function parseSchedule(input: string, now: Date = new Date()): ParsedSchedule {
	const raw = input.trim();
	if (!raw) return { kind: null, display: '', error: 'Indiquez quand la tâche doit tourner.' };

	if (raw.toLowerCase().startsWith('every ')) {
		const minutes = parseDuration(raw.slice(6));
		if (minutes === null) {
			return { kind: null, display: '', error: `Intervalle illisible. ${INVALID_HINT}` };
		}
		return { kind: 'interval', display: `toutes les ${humanMinutes(minutes)}`, error: '' };
	}

	const parts = raw.split(/\s+/);
	if (parts.length >= 5 && parts.slice(0, 5).every((p) => CRON_FIELD_RE.test(p))) {
		const bad = CRON_BOUNDS.findIndex(([min, max], i) => !cronFieldValid(parts[i], min, max));
		if (bad >= 0) {
			const names = ['minute', 'heure', 'jour du mois', 'mois', 'jour de la semaine'];
			return {
				kind: null,
				display: '',
				error: `Expression cron invalide : le champ « ${names[bad]} » (${parts[bad]}) est hors limites.`
			};
		}
		return { kind: 'cron', display: `selon la règle cron « ${raw} »`, error: '' };
	}

	if (raw.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(raw)) {
		const date = parseNaiveIso(raw);
		if (!date) {
			return { kind: null, display: '', error: `Date illisible. ${INVALID_HINT}` };
		}
		if (date.getTime() <= now.getTime()) {
			return { kind: null, display: '', error: 'Cette date est déjà passée.' };
		}
		return { kind: 'once', display: `une fois, le ${formatDateTime(date)}`, error: '' };
	}

	const minutes = parseDuration(raw);
	if (minutes !== null) {
		const at = new Date(now.getTime() + minutes * 60_000);
		return {
			kind: 'once',
			display: `une fois, dans ${humanMinutes(minutes)} (vers ${formatDateTime(at)})`,
			error: ''
		};
	}

	return { kind: null, display: '', error: `Horaire non reconnu. ${INVALID_HINT}` };
}

/** Ready-made schedules, because typing cron on a phone is nobody's idea of fun. */
export const SCHEDULE_PRESETS: { value: string; label: string }[] = [
	{ value: '30m', label: 'Dans 30 min' },
	{ value: '2h', label: 'Dans 2 h' },
	{ value: '1d', label: 'Demain' },
	{ value: 'every 1h', label: 'Toutes les heures' },
	{ value: '0 8 * * *', label: 'Chaque jour à 8 h' },
	{ value: '0 19 * * 5', label: 'Vendredi à 19 h' }
];

// ---------------------------------------------------------------------------
// Reading a job back
// ---------------------------------------------------------------------------

/**
 * The schedule as text.
 *
 * `job.schedule` is an OBJECT upstream (`{kind, expr|minutes|run_at, display}`),
 * not a string — rendering it directly prints "[object Object]".
 *
 * The structured fields come first, not `schedule_display`: upstream builds
 * that string in English and in raw minutes ("every 720m", "once at
 * 2026-12-31 23:59"), which has no place in this interface. It stays as the
 * fallback for shapes we don't recognise.
 */
export function scheduleDisplay(job: HermesJob): string {
	const schedule = job.schedule as Record<string, unknown> | string | undefined;

	if (schedule && typeof schedule === 'object') {
		const kind = schedule.kind;
		if (kind === 'interval' && typeof schedule.minutes === 'number') {
			return `toutes les ${humanMinutes(schedule.minutes)}`;
		}
		if (kind === 'cron' && typeof schedule.expr === 'string' && schedule.expr) {
			return schedule.expr;
		}
		if (kind === 'once' && typeof schedule.run_at === 'string') {
			const date = new Date(schedule.run_at);
			if (!Number.isNaN(date.getTime())) return `une fois, le ${formatDateTime(date)}`;
		}
	}

	const display = job.schedule_display;
	if (typeof display === 'string' && display.trim()) return display.trim();
	if (typeof schedule === 'string' && schedule) return schedule;
	if (schedule && typeof schedule === 'object') {
		for (const key of ['display', 'expr', 'run_at', 'kind']) {
			const value = schedule[key];
			if (typeof value === 'string' && value) return value;
		}
	}
	return '—';
}

export interface JobStateBadge {
	key: 'scheduled' | 'paused' | 'completed' | 'error' | 'running';
	icon: string;
	label: string;
}

/**
 * `effective_job_state` upstream already reconciles `enabled` with the pause
 * markers, so `state` is the field to trust; `enabled` is only a fallback for
 * records that predate it.
 */
export function jobState(job: HermesJob): JobStateBadge {
	const state = typeof job.state === 'string' ? job.state : job.enabled === false ? 'paused' : '';
	switch (state) {
		case 'paused':
			return { key: 'paused', icon: '⏸', label: 'En pause' };
		case 'completed':
			return { key: 'completed', icon: '✅', label: 'Terminée' };
		case 'error':
			return { key: 'error', icon: '⚠️', label: 'En erreur' };
		case 'running':
			return { key: 'running', icon: '⏳', label: 'En cours' };
		default:
			return { key: 'scheduled', icon: '⏰', label: 'Programmée' };
	}
}

/** "dans 2 h", "10 août 09:00", or '' when there is no next run. */
export function nextRunLabel(job: HermesJob, now: Date = new Date()): string {
	const raw = job.next_run_at;
	if (typeof raw !== 'string' || !raw) return '';
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return '';
	const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
	if (minutes < 0) return 'imminente';
	if (minutes < 1) return "dans moins d'une minute";
	if (minutes < 60 * 18) return `dans ${humanMinutes(minutes)}`;
	return formatDateTime(date);
}

/** Runnable jobs first, each group soonest-first; undated rows go last. */
export function sortJobs(jobs: HermesJob[]): HermesJob[] {
	const rank = (job: HermesJob) => (jobState(job).key === 'paused' ? 1 : 0);
	const at = (job: HermesJob) => {
		const raw = job.next_run_at;
		const time = typeof raw === 'string' ? new Date(raw).getTime() : NaN;
		return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
	};
	return [...jobs].sort((a, b) => rank(a) - rank(b) || at(a) - at(b));
}

export interface DeliveryTarget {
	id: string;
	name?: string;
	home_target_set?: boolean;
}

/**
 * Targets worth offering.
 *
 * Upstream lists every known platform; one without a configured home channel
 * resolves to no target at fire time (`_resolve_single_delivery_target` returns
 * None), so offering it would promise a delivery that silently never happens.
 * `local` is always kept — it is the "save only" default.
 */
export function usableTargets(targets: DeliveryTarget[]): DeliveryTarget[] {
	const kept = targets.filter((t) => t.id === 'local' || t.home_target_set);
	if (kept.some((t) => t.id === 'local')) return kept;
	return [{ id: 'local', name: 'Local (enregistré seulement)' }, ...kept];
}

/**
 * Label for a delivery choice.
 *
 * Upstream names are English ("Local (save only)"); only `local` needs
 * translating — every other id is a platform name that reads the same in both
 * languages.
 */
export function targetLabel(target: DeliveryTarget): string {
	if (target.id === 'local') return 'Local (enregistré seulement)';
	return target.name || target.id;
}

/** French one-liner for what a delivery choice actually does. */
export function deliveryHint(id: string): string {
	if (id === 'local') {
		return "Rien n'est envoyé : Hermes exécute la tâche et garde la sortie de son côté.";
	}
	return `Le résultat sera envoyé sur ${id}, sur le canal configuré pour Hermes.`;
}
