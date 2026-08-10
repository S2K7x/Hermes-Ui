import { api } from '$lib/client/api';
import { toasts } from './toast.svelte';
import { sortJobs, usableTargets, type DeliveryTarget } from '$lib/jobs';
import type { HermesJob } from '$lib/types';

interface JobsResponse {
	jobs: HermesJob[];
	targets: DeliveryTarget[];
	targetsAvailable: boolean;
}

/**
 * State of the scheduled-jobs panel.
 *
 * Its own store, like the skills editor: nothing here touches a conversation,
 * and it stays dormant until the panel is opened for the first time. Every
 * mutation re-reads the list rather than patching a row in place — the upstream
 * recomputes `state`, `next_run_at` and the repeat counter on each action, and
 * guessing those locally is how a panel starts lying.
 */
class JobsStore {
	/** null before the first load: "unknown", not "empty". */
	jobs = $state<HermesJob[] | null>(null);
	targets = $state<DeliveryTarget[]>([]);
	loading = $state(false);
	/** Set when the gateway has no cron module (HTTP 501). */
	unavailable = $state(false);
	/** Id of the job an action is running on, so only its buttons spin. */
	busyId = $state<string | null>(null);
	creating = $state(false);

	get sorted(): HermesJob[] {
		return sortJobs(this.jobs ?? []);
	}

	get deliveryChoices(): DeliveryTarget[] {
		return usableTargets(this.targets);
	}

	async refresh(quiet = false) {
		this.loading = true;
		try {
			const res = await api<JobsResponse>('/api/jobs', { timeoutMs: 15_000 });
			this.jobs = res.jobs ?? [];
			this.targets = res.targets ?? [];
			this.unavailable = false;
		} catch (err) {
			// 501 is Hermes saying it was built without the cron module — a
			// configuration fact to explain, not a failure to retry.
			if ((err as { status?: number })?.status === 501) {
				this.unavailable = true;
				this.jobs = [];
			} else if (!quiet) {
				toasts.error(err);
			}
		} finally {
			this.loading = false;
		}
	}

	/** Returns true when the job was created, so the form can close itself. */
	async create(input: {
		name: string;
		schedule: string;
		prompt: string;
		deliver: string;
	}): Promise<boolean> {
		if (this.creating) return false;
		this.creating = true;
		try {
			await api<{ job: HermesJob }>('/api/jobs', {
				method: 'POST',
				body: JSON.stringify(input),
				timeoutMs: 20_000
			});
			await this.refresh(true);
			toasts.success(`Tâche « ${input.name} » planifiée.`);
			return true;
		} catch (err) {
			toasts.error(err);
			return false;
		} finally {
			this.creating = false;
		}
	}

	async act(id: string, action: 'pause' | 'resume' | 'run') {
		if (this.busyId) return;
		this.busyId = id;
		try {
			await api(`/api/jobs/${encodeURIComponent(id)}`, {
				method: 'POST',
				body: JSON.stringify({ action }),
				timeoutMs: 20_000
			});
			await this.refresh(true);
			if (action === 'run') {
				toasts.success('Tâche lancée — le résultat suivra sa règle de livraison.');
			}
		} catch (err) {
			toasts.error(err);
		} finally {
			this.busyId = null;
		}
	}

	async remove(id: string) {
		if (this.busyId) return;
		this.busyId = id;
		try {
			await api(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE', timeoutMs: 15_000 });
			this.jobs = (this.jobs ?? []).filter((job) => job.id !== id);
			toasts.success('Tâche supprimée.');
		} catch (err) {
			toasts.error(err);
			await this.refresh(true);
		} finally {
			this.busyId = null;
		}
	}
}

export const jobsStore = new JobsStore();
