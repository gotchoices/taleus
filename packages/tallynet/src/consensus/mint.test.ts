import { canonicalEncode, type DigestValue } from '../digest.js'
import { makeNonce } from '../nonce.js'
import {
	DEFAULT_CONSENSUS_METHOD,
	MemberTypes,
	type DependentMember,
	type Link,
	type MemberType,
	type Plan,
	type UniQuery,
} from '../discovery/types.js'
import { mintRecord } from './mint.js'
import type { TrxTopology } from './types.js'

/**
 * Pure unit tests for {@link mintRecord}: the fold of one chosen {@link Plan} into the transaction
 * record the network settles. No discovery runs here (that is Part 3, `tallynet-mint-e2e`) and no
 * crypto is needed (`mintRecord` signs nothing) — every plan is hand-built with route-order members
 * and a path whose nonces are the real `makeNonce(sessionCode, linkId)` an owner would resolve, so the
 * session-code-reuse invariant is exercised with genuine nonces. Member/Payload/Terms shapes mirror
 * `consensus/participant.test.ts`.
 */

type TTerms = string
type TPayload = { amount: string }

const SESSION = 'session-code-reused-from-query'
const TX = 'transaction-code-minted-by-caller'
const LIFT_CONTRACT = 'bafyLiftContractCID'

/* ── hand-built plan pieces ──────────────────────────────────────────────────────────── */

function member(key: string, types: MemberType[], extra: Partial<DependentMember> = {}): DependentMember {
	return { types, address: { key }, ...extra }
}

/** A path link whose nonce is what the edge owner would derive for `linkId` under the reused session code. */
function link(linkId: string, intents: Record<string, TTerms> = { lift: 'terms' }): Link<TTerms> {
	return { nonce: makeNonce(SESSION, linkId), intents }
}

function makeQuery(overrides: Partial<UniQuery<TTerms>> = {}): UniQuery<TTerms> {
	return {
		target: { address: { key: 'target' } },
		sessionCode: SESSION,
		intents: { lift: 'want' },
		maxDepth: 7,
		method: DEFAULT_CONSENSUS_METHOD,
		...overrides,
	}
}

function mint(plan: Plan<TTerms, TPayload>, overrides: Partial<UniQuery<TTerms>> = {}) {
	return mintRecord<TTerms, TPayload>({ plan, query: makeQuery(overrides), payload: { amount: '100' }, transactionCode: TX })
}

/** Local mirror of the participant module's (unexported) duplicate-member check. */
function hasDuplicateMemberKey(topology: TrxTopology<TTerms>): boolean {
	const seen = new Set<string>()
	for (const m of topology.members) {
		if (seen.has(m.address.key)) {
			return true
		}
		seen.add(m.address.key)
	}
	return false
}

/** The keys of every member whose `types` include `role`, in topology order. */
function memberKeysWithRole(topology: TrxTopology<TTerms>, role: MemberType): string[] {
	return topology.members.filter((m) => m.types.includes(role)).map((m) => m.address.key)
}

/** alice (origin) → bob → carol (target, self-voter). Folded members in route order, carol [P,V]. */
function linearPlan(): Plan<TTerms, TPayload> {
	return {
		path: [link('L_ab'), link('L_bc')],
		members: [
			member('alice', [MemberTypes.participant]),
			member('bob', [MemberTypes.participant]),
			member('carol', [MemberTypes.participant, MemberTypes.voter]),
		],
	}
}

/* ── linear route ────────────────────────────────────────────────────────────────────── */

describe('mintRecord — linear route', () => {
	it('keeps participants in route order, origin-first and target-last', () => {
		const record = mint(linearPlan())
		expect(memberKeysWithRole(record.topology, MemberTypes.participant)).toEqual(['alice', 'bob', 'carol'])
	})

	it('builds one link per path hop, keyed by the path nonce, with correct source/target', () => {
		const record = mint(linearPlan())
		const links = record.topology.links
		expect(Object.keys(links).sort()).toEqual([makeNonce(SESSION, 'L_ab'), makeNonce(SESSION, 'L_bc')].sort())
		expect(links[makeNonce(SESSION, 'L_ab')]).toEqual({ source: 'alice', target: 'bob', intents: { lift: 'terms' } })
		expect(links[makeNonce(SESSION, 'L_bc')]).toEqual({ source: 'bob', target: 'carol', intents: { lift: 'terms' } })
	})

	it('stamps method, sessionCode (reused), transactionCode and payload', () => {
		const record = mint(linearPlan())
		expect(record.method).toBe(DEFAULT_CONSENSUS_METHOD)
		expect(record.sessionCode).toBe(SESSION)
		expect(record.transactionCode).toBe(TX)
		expect(record.payload).toEqual({ amount: '100' })
		expect(record.promises).toEqual([])
		expect(record.commits).toEqual([])
	})

	it('stamps liftContract when the query carries one', () => {
		const record = mint(linearPlan(), { liftContract: LIFT_CONTRACT })
		expect(record.liftContract).toBe(LIFT_CONTRACT)
	})

	it('omits liftContract entirely (never undefined) when the query has none', () => {
		const record = mint(linearPlan())
		expect(record).not.toHaveProperty('liftContract')
	})

	it('reuses the query session code so every link key is a real path nonce (nonceToLinkId resolves)', () => {
		const plan = linearPlan()
		const record = mint(plan)
		expect(record.sessionCode).toBe(SESSION)
		expect(new Set(Object.keys(record.topology.links))).toEqual(new Set(plan.path.map((l) => l.nonce)))
	})
})

/* ── voter folding ───────────────────────────────────────────────────────────────────── */

describe('mintRecord — voter folding', () => {
	it('carries a voter nominated by two participants as a single V-set entry', () => {
		// alice and bob both nominated external voter `vic`; discovery's fold de-duped it to one member.
		const plan: Plan<TTerms, TPayload> = {
			path: [link('L_ab'), link('L_bc')],
			members: [
				member('alice', [MemberTypes.participant], { dependsOn: [{ key: 'vic' }] }),
				member('bob', [MemberTypes.participant], { dependsOn: [{ key: 'vic' }] }),
				member('carol', [MemberTypes.participant]),
				member('vic', [MemberTypes.voter]),
			],
		}
		const record = mint(plan)
		expect(memberKeysWithRole(record.topology, MemberTypes.voter)).toEqual(['vic'])
		expect(hasDuplicateMemberKey(record.topology)).toBe(false)
	})

	it('carries a [P,V] participant as one member holding both roles', () => {
		const plan: Plan<TTerms, TPayload> = {
			path: [link('L_ab')],
			members: [member('alice', [MemberTypes.participant]), member('bob', [MemberTypes.participant, MemberTypes.voter])],
		}
		const record = mint(plan)
		const bob = record.topology.members.filter((m) => m.address.key === 'bob')
		expect(bob).toHaveLength(1)
		expect(bob[0].types).toEqual([MemberTypes.participant, MemberTypes.voter])
	})
})

/* ── circular route ──────────────────────────────────────────────────────────────────── */

describe('mintRecord — circular route', () => {
	it('closes the ring: the last link wraps to participants[0], originator stays one member', () => {
		// alice = originator = payee; ring alice → bob → alice. Two participants, two path links.
		const plan: Plan<TTerms, TPayload> = {
			path: [link('L_ab'), link('L_ba')],
			members: [
				member('alice', [MemberTypes.participant, MemberTypes.voter]),
				member('bob', [MemberTypes.participant, MemberTypes.voter]),
			],
		}
		const record = mint(plan)
		const links = record.topology.links
		expect(Object.keys(links)).toHaveLength(2)
		expect(links[makeNonce(SESSION, 'L_ab')]).toEqual({ source: 'alice', target: 'bob', intents: { lift: 'terms' } })
		// The closing link wraps target back to participants[0] = alice, though alice rides two links.
		expect(links[makeNonce(SESSION, 'L_ba')]).toEqual({ source: 'bob', target: 'alice', intents: { lift: 'terms' } })
		expect(record.topology.members.filter((m) => m.address.key === 'alice')).toHaveLength(1)
		expect(hasDuplicateMemberKey(record.topology)).toBe(false)
	})
})

/* ── voter-set sizes (shape only; settlement is Part 3) ──────────────────────────────── */

describe('mintRecord — voter-set sizes', () => {
	// A linear route alice → bob → carol (target) plus `voterCount` external voter-only nominees.
	function planWithVoters(voterCount: number): Plan<TTerms, TPayload> {
		const voters = Array.from({ length: voterCount }, (_unused, i) => member(`vic${i}`, [MemberTypes.voter]))
		return {
			path: [link('L_ab'), link('L_bc')],
			members: [
				member('alice', [MemberTypes.participant]),
				member('bob', [MemberTypes.participant]),
				member('carol', [MemberTypes.participant]),
				...voters,
			],
		}
	}

	it.each([1, 2, 3, 7])('mints a valid topology for %i voter(s)', (voterCount) => {
		const record = mint(planWithVoters(voterCount))
		expect(memberKeysWithRole(record.topology, MemberTypes.voter)).toHaveLength(voterCount)
		expect(memberKeysWithRole(record.topology, MemberTypes.participant)).toEqual(['alice', 'bob', 'carol'])
		expect(Object.keys(record.topology.links)).toHaveLength(2)
		expect(hasDuplicateMemberKey(record.topology)).toBe(false)
	})
})

/* ── failure cases ───────────────────────────────────────────────────────────────────── */

describe('mintRecord — rejects an unsettleable plan', () => {
	it('throws on a voterless plan (no V member → can never reach consensus)', () => {
		const plan: Plan<TTerms, TPayload> = {
			path: [link('L_ab')],
			members: [member('alice', [MemberTypes.participant]), member('bob', [MemberTypes.participant])],
		}
		expect(() => mint(plan)).toThrow(/no voter members/)
	})

	it('throws on a plan with no participant members', () => {
		const plan: Plan<TTerms, TPayload> = { path: [], members: [member('vic', [MemberTypes.voter])] }
		expect(() => mint(plan)).toThrow(/no participant members/)
	})

	it('throws when the path link count fits neither a linear nor a circular route', () => {
		// Three participants, but only... zero links. Neither participants-1 (=2) nor participants (=3).
		const plan: Plan<TTerms, TPayload> = {
			path: [],
			members: [
				member('alice', [MemberTypes.participant, MemberTypes.voter]),
				member('bob', [MemberTypes.participant]),
				member('carol', [MemberTypes.participant]),
			],
		}
		expect(() => mint(plan)).toThrow(/path has 0 link\(s\) but 3 participant\(s\)/)
	})
})

/* ── digest-safety ───────────────────────────────────────────────────────────────────── */

describe('mintRecord — the minted record is digest-safe', () => {
	// The record is the signed preimage: it must canonically encode (DAG-CBOR), which rejects any
	// `undefined`-valued key. Proves the `liftContract` omit-don't-undefine invariant end to end —
	// a regression that always stamped `liftContract` would throw here when the query carries none.
	it('canonically encodes when the query carries no liftContract (key omitted, not undefined)', () => {
		const record = mint(linearPlan())
		expect(() => canonicalEncode(record as unknown as DigestValue)).not.toThrow()
	})

	it('canonically encodes when the query carries a liftContract', () => {
		const record = mint(linearPlan(), { liftContract: LIFT_CONTRACT })
		expect(() => canonicalEncode(record as unknown as DigestValue)).not.toThrow()
	})
})
