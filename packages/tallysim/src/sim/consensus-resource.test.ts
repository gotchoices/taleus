import { MemberTypes, type DependentMember, type MemberType, type ResourceContext } from 'tallynet'
import {
	makeSimResources,
	obscureRefereeCount,
	refusesStackedVoterSet,
	type StackedVoterPolicy,
} from './consensus-resource.js'
import type { LiftTerms } from './terms.js'

const PART: MemberType = MemberTypes.participant
const VOTER: MemberType = MemberTypes.voter

/** A throwaway context — the doubles only ever store it or hand it to a gate; they never read its fields. */
const ctx = { member: { types: [], address: { key: 'k' } }, inLinks: [], outLinks: [], record: {} } as unknown as ResourceContext<
	LiftTerms,
	unknown
>

/** A member keyed by a node name whose number is its entity id (as `memberEntity` reads it below). */
function member(key: string, types: MemberType[]): DependentMember {
	return { types, address: { key } }
}

/** A resource context exposing just the `record.topology.members` the `acceptsProposal` gate reads. */
function ctxWithMembers(members: DependentMember[]): ResourceContext<LiftTerms, unknown> {
	return {
		member: member('0', [PART]),
		inLinks: [],
		outLinks: [],
		record: { topology: { members, links: {} } },
	} as unknown as ResourceContext<LiftTerms, unknown>
}

/** Entities 2 and 3 are the well-known hubs; any other voter is obscure. Keys are read as entity ids. */
const policy = (obscureTolerance?: number): StackedVoterPolicy => ({
	wellKnown: new Set([2, 3]),
	memberEntity: (m) => Number(m.address.key),
	...(obscureTolerance === undefined ? {} : { obscureTolerance }),
})

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

	it('the cooperative default installs no acceptsProposal gate and never counts a voter-set refusal', () => {
		const { resourceFor, handles } = makeSimResources({})
		const resource = resourceFor(0)
		expect('acceptsProposal' in resource).toBe(false)
		expect(handles.get(0)!.voterSetRefusals).toBe(0)
	})
})

describe('refusesStackedVoterSet / obscureRefereeCount — the pure voter-set refusal predicate', () => {
	it('counts only V-only referees whose entity is not well-known', () => {
		const members = [
			member('0', [PART]), // a plain participant — not a voter
			member('2', [VOTER]), // a well-known referee (entity 2 ∈ {2,3})
			member('7', [VOTER]), // an obscure referee (entity 7 ∉ {2,3})
			member('8', [VOTER]), // another obscure referee
		]
		expect(obscureRefereeCount(members, policy())).toBe(2)
	})

	it('does not count a [P,V] voter — a participant voting itself is on the money path, not a padding referee', () => {
		const members = [member('9', [PART, VOTER])] // obscure entity, but also a participant ⇒ not a referee
		expect(obscureRefereeCount(members, policy())).toBe(0)
		expect(refusesStackedVoterSet(members, policy())).toBe(false)
	})

	it('treats an unresolvable member (entity undefined) as obscure', () => {
		const undefPolicy: StackedVoterPolicy = { wellKnown: new Set([2]), memberEntity: () => undefined }
		expect(obscureRefereeCount([member('2', [VOTER])], undefPolicy)).toBe(1)
	})

	it('refuses past the tolerance, accepts at or under it', () => {
		const stacked = [member('7', [VOTER]), member('8', [VOTER])] // 2 obscure referees
		expect(refusesStackedVoterSet(stacked, policy())).toBe(true) // default tolerance 0 → 2 > 0
		expect(refusesStackedVoterSet(stacked, policy(1))).toBe(true) // 2 > 1
		expect(refusesStackedVoterSet(stacked, policy(2))).toBe(false) // 2 ≤ 2
		const lean = [member('7', [VOTER])] // 1 obscure referee
		expect(refusesStackedVoterSet(lean, policy(1))).toBe(false) // 1 ≤ 1
	})
})

describe('makeSimResources — refuseStackedVoters installs an acceptsProposal gate', () => {
	it('accepts a lean/well-known voter set and leaves the refusal counter at 0', () => {
		const { resourceFor, handles } = makeSimResources({ 0: { refuseStackedVoters: policy() } })
		const resource = resourceFor(0)
		const members = [member('0', [PART]), member('1', [PART]), member('2', [VOTER])] // referee 2 is well-known
		expect(resource.acceptsProposal?.(ctxWithMembers(members))).toBe(true)
		expect(handles.get(0)!.voterSetRefusals).toBe(0)
	})

	it('refuses a stacked voter set (signs NP) and counts each refusal distinctly on the handle', () => {
		const { resourceFor, handles } = makeSimResources({ 0: { refuseStackedVoters: policy() } })
		const resource = resourceFor(0)
		const stacked = ctxWithMembers([member('0', [PART]), member('7', [VOTER]), member('8', [VOTER])])
		expect(resource.acceptsProposal?.(stacked)).toBe(false)
		expect(resource.acceptsProposal?.(stacked)).toBe(false)
		expect(handles.get(0)!.voterSetRefusals).toBe(2) // two refusals, counted separately from shouldPromise
	})

	it('honours the configured tolerance before refusing', () => {
		const { resourceFor } = makeSimResources({ 0: { refuseStackedVoters: policy(1) } })
		const resource = resourceFor(0)
		const oneObscure = ctxWithMembers([member('7', [VOTER])]) // 1 ≤ tolerance 1 → accept
		const twoObscure = ctxWithMembers([member('7', [VOTER]), member('8', [VOTER])]) // 2 > 1 → refuse
		expect(resource.acceptsProposal?.(oneObscure)).toBe(true)
		expect(resource.acceptsProposal?.(twoObscure)).toBe(false)
	})
})
