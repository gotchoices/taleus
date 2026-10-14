import { guarded, storeUnavailable } from './unavailable.js'
import { ok } from './translate.js'

class BlockUnavailableError extends Error {
	override name = 'BlockUnavailableError'
}

describe('an unreachable store, said as a retryable failure', () => {
	it('recognizes Optimystic\'s error anywhere in the cause chain, as Quereus wraps it', () => {
		const inner = new BlockUnavailableError('Block default/app/CloseRequest is unavailable (cohort-unreachable)')
		const wrapped = new Error('Query failed', { cause: new Error('Module connect failed', { cause: inner }) })
		expect(storeUnavailable(wrapped)).toBe(true)
		expect(storeUnavailable(new Error('Block default/app/Invoice is unavailable (peers-unreachable): …'))).toBe(true)
		expect(storeUnavailable(new TypeError('x is not a function'))).toBe(false)
	})

	it('turns that rejection into a retryable result, and lets anything else through', async () => {
		const namespace = guarded({
			unreachable: () => Promise.reject(new BlockUnavailableError('Block b is unavailable (cohort-unreachable)')),
			broken: () => Promise.reject(new TypeError('a defect')),
			fine: () => Promise.resolve(ok(1)),
			plain: () => 'not a promise',
		})
		const failure = await namespace.unreachable()
		expect(failure).toMatchObject({ ok: false, error: { kind: 'store-unavailable', retryable: true } })
		await expect(namespace.broken()).rejects.toThrow('a defect')
		expect(await namespace.fine()).toEqual({ ok: true, value: 1 })
		expect(namespace.plain()).toBe('not a promise')
	})
})
