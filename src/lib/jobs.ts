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
		const human = humanCron(raw);
		return {
			kind: 'cron',
			display: human || `selon la règle cron « ${raw} »`,
			error: ''
		};
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

// ---------------------------------------------------------------------------
// Choosing a schedule without writing cron
// ---------------------------------------------------------------------------

/**
 * A schedule as the form holds it, before it becomes an expression.
 *
 * Everything upstream accepts is still an expression string — this is only the
 * shape the pickers manipulate, so nobody has to know that "chaque lundi à 8 h"
 * is spelled `0 8 * * 1`. `scheduleFromSpec()` renders it, `specFromExpression()`
 * reads it back when an existing job is reopened for editing.
 */
export type ScheduleMode = 'interval' | 'daily' | 'weekly' | 'monthly' | 'once' | 'advanced';

export interface ScheduleSpec {
	mode: ScheduleMode;
	/** "HH:MM" — daily, weekly and monthly. */
	time: string;
	/** Cron day of week, 0 = dimanche. */
	weekday: number;
	/** Day of month. Capped at 28 in the picker: 29-31 skip months. */
	monthday: number;
	/** `every <count><unit>`. */
	every: number;
	unit: 'm' | 'h' | 'd';
	/** A `datetime-local` value, for a one-shot. */
	at: string;
	/** The raw expression, in advanced mode. */
	raw: string;
}

export const SCHEDULE_MODES: { value: ScheduleMode; label: string }[] = [
	{ value: 'daily', label: 'Chaque jour' },
	{ value: 'weekly', label: 'Chaque semaine' },
	{ value: 'monthly', label: 'Chaque mois' },
	{ value: 'interval', label: 'À intervalle' },
	{ value: 'once', label: 'Une seule fois' },
	{ value: 'advanced', label: 'Expression' }
];

/** Cron numbering, French labels, week starting on Monday. */
export const WEEKDAYS: { value: number; label: string }[] = [
	{ value: 1, label: 'lundi' },
	{ value: 2, label: 'mardi' },
	{ value: 3, label: 'mercredi' },
	{ value: 4, label: 'jeudi' },
	{ value: 5, label: 'vendredi' },
	{ value: 6, label: 'samedi' },
	{ value: 0, label: 'dimanche' }
];

/** Cron accepts both 0 and 7 for Sunday; croniter does, so this must too. */
export function weekdayLabel(value: number): string {
	if (value === 7) return 'dimanche';
	return WEEKDAYS.find((d) => d.value === value)?.label ?? '';
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "2026-08-12T09:00" — the value an `<input type="datetime-local">` wants. */
export function localDateTimeValue(date: Date): string {
	return (
		`${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
		`T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
	);
}

/** A sane starting point: every day at 08:00, one-shot pre-filled for tomorrow. */
export function defaultScheduleSpec(now: Date = new Date()): ScheduleSpec {
	const tomorrow = new Date(now.getTime() + 86_400_000);
	tomorrow.setHours(9, 0, 0, 0);
	return {
		mode: 'daily',
		time: '08:00',
		weekday: 1,
		monthday: 1,
		every: 1,
		unit: 'h',
		at: localDateTimeValue(tomorrow),
		raw: ''
	};
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/**
 * Render a spec as the expression Hermes parses.
 *
 * Returns '' when the spec is not filled in yet — `parseSchedule('')` then says
 * so in French, which keeps one single place deciding what a valid schedule is.
 */
export function scheduleFromSpec(spec: ScheduleSpec): string {
	if (spec.mode === 'advanced') return spec.raw.trim();
	if (spec.mode === 'once') return spec.at.trim();
	if (spec.mode === 'interval') {
		if (!Number.isInteger(spec.every) || spec.every < 1) return '';
		return `every ${spec.every}${spec.unit}`;
	}

	const match = TIME_RE.exec(spec.time.trim());
	if (!match) return '';
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) return '';

	if (spec.mode === 'weekly') {
		const day = Number.isInteger(spec.weekday) ? spec.weekday : 1;
		return `${minute} ${hour} * * ${day}`;
	}
	if (spec.mode === 'monthly') {
		const day = Math.min(Math.max(Math.trunc(spec.monthday) || 1, 1), 31);
		return `${minute} ${hour} ${day} * *`;
	}
	return `${minute} ${hour} * * *`;
}

const NUM_RE = /^\d{1,2}$/;
const asNumber = (field: string): number | null => (NUM_RE.test(field) ? Number(field) : null);

/**
 * Read an expression back into a spec, so editing a job reopens the picker it
 * was created with instead of dumping cron in the user's face.
 *
 * Anything that isn't one of the shapes the pickers produce lands in advanced
 * mode with the expression intact — a job created from the CLI with a stepped
 * or ranged expression must survive a round trip through this panel untouched.
 */
export function specFromExpression(input: string, now: Date = new Date()): ScheduleSpec {
	const spec = defaultScheduleSpec(now);
	const raw = (input ?? '').trim();
	if (!raw) return { ...spec, mode: 'advanced', raw: '' };

	if (raw.toLowerCase().startsWith('every ')) {
		const minutes = parseDuration(raw.slice(6));
		if (minutes !== null) {
			const [every, unit]: [number, ScheduleSpec['unit']] =
				minutes % 1440 === 0
					? [minutes / 1440, 'd']
					: minutes % 60 === 0
						? [minutes / 60, 'h']
						: [minutes, 'm'];
			return { ...spec, mode: 'interval', every, unit };
		}
		return { ...spec, mode: 'advanced', raw };
	}

	const parts = raw.split(/\s+/);
	if (parts.length === 5) {
		const [mi, ho, dom, mon, dow] = parts;
		const minute = asNumber(mi);
		const hour = asNumber(ho);
		if (minute !== null && hour !== null && minute < 60 && hour < 24 && mon === '*') {
			const time = `${pad2(hour)}:${pad2(minute)}`;
			if (dom === '*' && dow === '*') return { ...spec, mode: 'daily', time };
			const weekday = asNumber(dow);
			if (dom === '*' && weekday !== null && weekday <= 7) {
				return { ...spec, mode: 'weekly', time, weekday: weekday === 7 ? 0 : weekday };
			}
			const monthday = asNumber(dom);
			if (dow === '*' && monthday !== null && monthday >= 1 && monthday <= 31) {
				return { ...spec, mode: 'monthly', time, monthday };
			}
		}
		return { ...spec, mode: 'advanced', raw };
	}

	if (raw.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(raw)) {
		const date = parseNaiveIso(raw);
		if (date) return { ...spec, mode: 'once', at: localDateTimeValue(date) };
	}

	return { ...spec, mode: 'advanced', raw };
}

/**
 * A cron expression in French, when it has a shape worth naming.
 *
 * Returns '' for anything else — the caller then shows the expression itself,
 * which is more honest than an approximate translation.
 */
export function humanCron(expr: string): string {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) return '';
	const [mi, ho, dom, mon, dow] = parts;
	const minute = asNumber(mi);
	const hour = asNumber(ho);

	if (minute !== null && hour !== null && minute < 60 && hour < 24 && mon === '*') {
		const at = `${pad2(hour)} h ${pad2(minute)}`;
		if (dom === '*' && dow === '*') return `chaque jour à ${at}`;
		const weekday = asNumber(dow);
		if (dom === '*' && weekday !== null && weekday <= 7) {
			return `chaque ${weekdayLabel(weekday)} à ${at}`;
		}
		const monthday = asNumber(dom);
		if (dow === '*' && monthday !== null && monthday >= 1 && monthday <= 31) {
			return `le ${monthday} de chaque mois à ${at}`;
		}
	}

	if (ho === '*' && dom === '*' && mon === '*' && dow === '*' && mi.startsWith('*/')) {
		const step = asNumber(mi.slice(2));
		if (step && step < 60) return `toutes les ${humanMinutes(step)}`;
	}
	if (minute !== null && dom === '*' && mon === '*' && dow === '*' && ho.startsWith('*/')) {
		const step = asNumber(ho.slice(2));
		if (step && step < 24) return `toutes les ${humanMinutes(step * 60)}, à la minute ${minute}`;
	}
	return '';
}

// ---------------------------------------------------------------------------
// The agent behind a task
// ---------------------------------------------------------------------------

/**
 * What is inserted between an agent's card and the task itself.
 *
 * A scheduled run has no conversation and no reader: saying so once, here, is
 * worth more than hoping every instruction repeats it.
 */
export const JOB_PROMPT_HEADER = [
	'## Ta tâche planifiée',
	"Le planificateur de Hermes déclenche cette tâche tout seul : il n'y a ni conversation précédente, ni personne pour répondre à une question pendant l'exécution. Va au bout, et rends un résultat qui se comprend seul.",
	'',
	'Voici la tâche :'
].join('\n');

/** Characters the header costs, blank-line joins included. */
const HEADER_COST = JOB_PROMPT_HEADER.length + 4;

/** The instruction budget, given whether an agent is attached. */
export const jobInstructionLimit = (hasPersona: boolean): number =>
	MAX_JOB_PROMPT - (hasPersona ? HEADER_COST : 0);

export interface ComposedJobPrompt {
	/** What actually gets stored as the job's `prompt` upstream. */
	prompt: string;
	/** Characters the agent's card and its header take out of the budget. */
	personaChars: number;
	/** True when the card had to be cut to fit under `MAX_JOB_PROMPT`. */
	clipped: boolean;
}

/**
 * Bake an agent's persona into the job prompt.
 *
 * Hermes' cron has no notion of a persona: `create_job` stores a prompt and
 * nothing else, and the API server forwards neither a system message nor a
 * model (`_handle_create_job` passes only name / schedule / prompt / deliver /
 * skills / repeat). So the card travels *inside* the prompt — which is also why
 * it has to fit under the upstream 5 000-character cap, the instruction first.
 *
 * With no agent the prompt is the instruction, byte for byte: a task planned
 * before agents existed must keep behaving exactly as it did.
 */
export function composeJobPrompt(persona: string, instruction: string): ComposedJobPrompt {
	const task = instruction.trim();
	const card = persona.trim();
	if (!card) return { prompt: task, personaChars: 0, clipped: false };

	const room = MAX_JOB_PROMPT - task.length - HEADER_COST;
	if (room <= 0) return { prompt: task, personaChars: 0, clipped: true };

	const kept = card.length <= room ? card : `${card.slice(0, room - 1)}…`;
	return {
		prompt: `${kept}\n\n${JOB_PROMPT_HEADER}\n\n${task}`,
		personaChars: kept.length + HEADER_COST,
		clipped: kept.length < card.length
	};
}

/** Ready-made tasks — a first job in two taps rather than a blank form. */
export const JOB_TEMPLATES: { label: string; name: string; instruction: string }[] = [
	{
		label: 'Résumé du matin',
		name: 'Résumé du matin',
		instruction:
			"Fais le point du jour en dix lignes maximum : la météo du jour ici, l'état du Raspberry Pi (charge, espace disque, services en échec), et ce qui mérite mon attention. Termine par une seule action recommandée."
	},
	{
		label: 'Veille du soir',
		name: 'Veille du soir',
		instruction:
			"Cherche les nouveautés du jour sur mes sujets techniques (self-hosting, IA locale, Raspberry Pi) et résume-les en cinq puces sourcées. Ignore ce qui n'est qu'une annonce commerciale."
	},
	{
		label: 'Sauvegarde vérifiée',
		name: 'Vérification des sauvegardes',
		instruction:
			"Vérifie que les sauvegardes du Pi de la nuit sont bien passées : la dernière archive présente, sa date, sa taille, et l'espace disque restant. Si quelque chose cloche, dis-le en premier et explique quoi faire."
	}
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
			return humanCron(schedule.expr) || schedule.expr;
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

/**
 * The stored schedule, back as the expression that produced it.
 *
 * Editing a task means sending `schedule` up again — upstream re-parses the
 * string and recomputes `next_run_at` — so the panel needs the round trip from
 * the parsed object Hermes returns. `minutes` comes back in minutes whatever
 * unit was typed, which `specFromExpression` folds into hours or days again.
 */
export function scheduleExpression(job: HermesJob): string {
	const schedule = job.schedule as Record<string, unknown> | string | undefined;
	if (schedule && typeof schedule === 'object') {
		const kind = schedule.kind;
		if (kind === 'interval' && typeof schedule.minutes === 'number') {
			return `every ${schedule.minutes}m`;
		}
		if (kind === 'cron' && typeof schedule.expr === 'string' && schedule.expr) {
			return schedule.expr;
		}
		if (kind === 'once' && typeof schedule.run_at === 'string') return schedule.run_at;
	}
	if (typeof schedule === 'string' && schedule) return schedule;
	return typeof job.schedule_display === 'string' ? job.schedule_display : '';
}

/**
 * May this task be edited as it stands?
 *
 * False for a one-shot whose date has passed: re-sending that schedule is
 * exactly what `update_job` refuses (ValueError → HTTP 500), so the panel
 * offers a new date instead of a broken button. Everything else round-trips.
 */
export const canEditJob = (job: HermesJob, now: Date = new Date()): boolean =>
	parseSchedule(scheduleExpression(job), now).kind !== null;

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

/**
 * The last run, as one short line: when, and how it went.
 *
 * `last_status` values come from `mark_job_run` upstream — "ok" / "error", plus
 * the two the scheduler writes itself ("blocked_config" when the job's provider
 * config is unusable, "no_change" for a monitor tick that suppressed the run).
 * An unknown value is shown as "terminée" rather than guessed at.
 */
export function lastRunLabel(job: HermesJob): string {
	const raw = job.last_run_at;
	if (typeof raw !== 'string' || !raw) return '';
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return '';

	const status = typeof job.last_status === 'string' ? job.last_status : '';
	const outcome =
		status === 'ok'
			? 'réussie'
			: status === 'error'
				? 'échouée'
				: status === 'blocked_config'
					? 'bloquée (configuration)'
					: status === 'no_change'
						? 'rien de neuf'
						: status
							? 'terminée'
							: '';
	return `dernière ${formatDateTime(date)}${outcome ? ` · ${outcome}` : ''}`;
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
