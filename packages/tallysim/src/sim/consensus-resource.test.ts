import type { ResourceContext } from 'tallynet'
import { makeSimResources } from './consensus-resource.js'
import type { LiftTerms } from './terms.js'

/** A throwaway context — the doubles only ever store it or hand it to a gate; they never read its fields. */
const ctx = { member: { types: [], address: { key: 'k' } }, inLinks: [], outLinks: [], record: {} } as unknown as ResourceContext<
	LiftTerms,
	unknown
>

describe('makeSimResources — failure-injecting resource ports keyed by entity id', () => {
	it('lazily mints one handle per entity id; a repeat call returns the same resource', () => {
		const { resourceFor, handles } = makeSimResources({})
		const r0 = resourceFor(0)
		expect(resourceFor(0)).toBe(r0) // same instance, not a fresh mint
		expect(handles.size).toBe(1)
		expect(handles.get(0)!.resource).toBe(r0)
	})

	it('the default (cooperative) handle installs no gate hooks', () => {
		const resource = makeSimResources({}).resourceFor(0)
		expect('shouldPromise' in resource).toBe(false) // omitted ⇒ the engine defaults true → promises
		expect('shouldCommit' in resource).toBe(false) // omitted ⇒ the engine defaults true → commits
	})

	it('records each promise hold and each release outcome', () => {
		const { resourceFor, handles } = makeSimResources({})
		const resource = resourceFor(0)
		// `promise`/`release` are typed `void | Promise<void>`; the double is synchronous, so ignore the result.
		void resource.promise(ctx)
		void resource.release({ ...ctx, success: true })
		expect(handles.get(0)!.promiseCtxs).toEqual([ctx]) // the hold was recorded
		expect(handles.get(0)!.releaseSuccesses).toEqual([true]) // released once, as a commit
	})

	it('shouldPromise:false installs a declining promise gate', () => {
		const declined = makeSimResources({ 1: { shouldPromise: false } }).resourceFor(1).shouldPromise?.(ctx)
		expect(declined).toBe(false)
	})

	it('shouldCommit:false installs a declining vote gate (an R member would sign NC)', () => {
		const declined = makeSimResources({ 2: { shouldCommit: false } }).resourceFor(2).shouldCommit?.(ctx)
		expect(declined).toBe(false)
	})

	it('promiseThrows:true makes promise throw, holding nothing', () => {
		const { resourceFor, handles } = makeSimResources({ 3: { promiseThrows: true } })
		expect(() => resourceFor(3).promise(ctx)).toThrow(/promise refused/)
		expect(handles.get(3)!.promiseCtxs).toEqual([]) // threw before recording a hold
	})

	it('keys specs by entity id: an unspecified id gets the cooperative default', () => {
		const { resourceFor } = makeSimResources({ 1: { shouldPromise: false } })
		expect('shouldPromise' in resourceFor(0)).toBe(false) // id 0 was not in the specs
		expect('shouldPromise' in resourceFor(1)).toBe(true) // id 1 was
	})
})
