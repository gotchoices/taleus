/**
 * A store that cannot reach its data right now -- an Optimystic block no reachable cohort member
 * answered for, a strand still waiting for its first sync -- is a moment's condition, not a defect.
 * The model says so as a retryable `DataError` instead of letting the exception through: a screen
 * offers to try again, a CLI command reports exit 3, and nothing dies uncaught. Anything else still
 * throws.
 */
import type { Result } from '../types.js'
import { failed } from './translate.js'

const UNAVAILABLE_NAMES = new Set(['BlockUnavailableError', 'StrandAwaitingFirstSyncError'])
const UNAVAILABLE_TEXT = /is unavailable \((?:cohort|peers)-unreachable\)|is not writable yet/

/** Whether `error`, or any error in its cause chain, is the store being out of reach. */
export function storeUnavailable(error: unknown): boolean {
	for (let at: unknown = error, depth = 0; at && depth < 8; at = (at as { cause?: unknown }).cause, depth++) {
		if (at instanceof Error && (UNAVAILABLE_NAMES.has(at.name) || UNAVAILABLE_TEXT.test(at.message))) return true
	}
	return false
}

type Method = (...args: never[]) => unknown

/**
 * `namespace` with each method that returns a promise of a `Result` turning an unavailable store into
 * a retryable failure. Methods that return plainly are left as they are.
 */
export function guarded<T extends object>(namespace: T): T {
	const wrapped = { ...namespace } as Record<string, unknown>
	for (const [name, value] of Object.entries(namespace)) {
		if (typeof value !== 'function') continue
		const method = value as Method
		wrapped[name] = (...args: never[]) => {
			const result = method.apply(namespace, args)
			if (!(result instanceof Promise)) return result
			return result.catch((error: unknown): Result<never> => {
				if (!storeUnavailable(error)) throw error
				return failed('store-unavailable', `the tally's data cannot be reached right now: ${(error as Error).message}`, true)
			})
		}
	}
	return wrapped as T
}
