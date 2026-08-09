import { humanizeError } from '$lib/errors';

export type ToastKind = 'error' | 'info' | 'success';

export interface Toast {
	id: number;
	kind: ToastKind;
	message: string;
	/** Optional single action, e.g. "Réessayer". */
	action?: { label: string; run: () => void };
	/** ms until auto-dismiss; 0 keeps it until dismissed. */
	ttl: number;
}

let nextId = 1;

class ToastStore {
	items = $state<Toast[]>([]);

	push(
		kind: ToastKind,
		message: string,
		opts: { action?: Toast['action']; ttl?: number } = {}
	): number {
		const id = nextId++;
		// Errors stay until acknowledged: a toast that vanishes before it is
		// read is worse than no toast, because the user knows something broke
		// and has no way to find out what.
		const ttl = opts.ttl ?? (kind === 'error' ? 0 : 3500);
		this.items = [...this.items, { id, kind, message, action: opts.action, ttl }];
		if (ttl > 0) setTimeout(() => this.dismiss(id), ttl);
		return id;
	}

	/** Report a thrown value, translated into something actionable. */
	error(err: unknown, action?: Toast['action']): number {
		return this.push('error', humanizeError(err), { action });
	}

	info = (message: string) => this.push('info', message);
	success = (message: string) => this.push('success', message);

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}

	clear() {
		this.items = [];
	}
}

export const toasts = new ToastStore();
