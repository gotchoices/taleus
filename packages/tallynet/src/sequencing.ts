/**
 * Step sequencing: await a batch of asynchronous requests up to a fixed time budget, then proceed
 * with whatever has completed. A discovery round uses this to fan out sub-queries and move on when
 * the slowest peers run past the budget. Ported from ChipNet's `sequencing.ts`/`pending.ts`, with
 * two fixes called out in docs/chipnet-review.md:
 *
 *   - the budget timer is **always cleared** when the step ends early, so no timer outlives the
 *     step (a leaked timer keeps a Node process -- or a jest worker -- alive);
 *   - the step accepts an **abort signal**, so a caller can end it before the budget elapses.
 */

/**
 * A promise with its settlement observable synchronously: whether it has completed, its value or
 * error, and how long it took. Wrapping a request in `Pending` lets {@link budgetedStep} poll
 * "are all of these done?" without re-awaiting each one.
 */
export class Pending<T> {
	response?: T
	error?: unknown
	duration?: number
	readonly t1: number = Date.now()
	private state: 'pending' | 'resolved' | 'rejected' = 'pending'

	constructor(public readonly promise: Promise<T>) {
		promise.then(
			(response) => {
				this.duration = Date.now() - this.t1
				this.response = response
				this.state = 'resolved'
				return response
			},
			(error: unknown) => {
				this.duration = Date.now() - this.t1
				this.error = error
				this.state = 'rejected'
			},
		)
	}

	/** Resolved with a value. */
	get isResponse(): boolean {
		return this.state === 'resolved'
	}

	/** Rejected with an error. */
	get isError(): boolean {
		return this.state === 'rejected'
	}

	/** Settled either way. A rejection counts as complete. */
	get isComplete(): boolean {
		return this.state !== 'pending'
	}

	/** The settled value, re-throwing the error if it rejected; otherwise awaits the promise. */
	async result(): Promise<T> {
		if (this.state === 'resolved') {
			return this.response as T
		}
		if (this.state === 'rejected') {
			throw this.error
		}
		return this.promise
	}
}

export interface BudgetedStepOptions {
	/** Abort the step early (resolves it). Already-aborted on entry resolves immediately. */
	signal?: AbortSignal
}

/**
 * Wait until every request in `requests` has completed, or `budgetMs` elapses, or `options.signal`
 * aborts -- whichever comes first. Resolves (never rejects) regardless of individual outcomes; a
 * rejected request counts as complete, and the caller inspects each `Pending` afterwards. An empty
 * `requests` set resolves immediately without arming a timer.
 */
export async function budgetedStep<RT>(
	budgetMs: number,
	requests: Record<string, Pending<RT>>,
	options: BudgetedStepOptions = {},
): Promise<void> {
	const pendings = Object.values(requests)
	const allComplete = (): boolean => pendings.every((p) => p.isComplete)
	const { signal } = options

	if (allComplete() || signal?.aborted) {
		return
	}

	let timer: unknown
	let onAbort: (() => void) | undefined

	await new Promise<void>((resolve) => {
		const finish = (): void => resolve()
		const checkDone = (): void => {
			if (allComplete()) {
				finish()
			}
		}

		timer = setTimeout(finish, budgetMs)
		if (signal) {
			onAbort = finish
			signal.addEventListener('abort', onAbort, { once: true })
		}
		for (const p of pendings) {
			void p.result().then(checkDone, checkDone)
		}
	}).finally(() => {
		clearTimeout(timer)
		if (signal && onAbort) {
			signal.removeEventListener('abort', onAbort)
		}
	})
}
