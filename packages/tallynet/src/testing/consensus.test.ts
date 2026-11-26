/**
 * End-to-end consensus over the in-memory network. Where `consensus/participant.test.ts` drives one
 * `TrxParticipant` against stub ports, these scenarios wire a whole graph of {@link ConsensusNode}s
 * over one {@link InMemoryNetwork} + {@link VirtualClock} and push a real lift record from the
 * originator until the whole route settles — proving the ticket's headline invariant: a found route
 * **commits everywhere or voids everywhere**, atomically, including under crooked and failing peers.
 *
 * The driving pattern throughout (see {@link runLift}):
 *
 *     const { record, transactionCode } = net.buildLift(spec)
 *     await net.consensusNode(spec.route[0]).start(record) // seed the originator; schedules its pushes
 *     await net.clock.runUntilIdle()                        // fire every scheduled record-push, in order
 *     // then: every node's outcome(transactionCode) agrees, and each member released exactly once
 *
 * ── Three notes for the reader ─────────────────────────────────────────────────────────────────────
 *
 * - **Member keys are not node names.** A `TrxParticipant` rejects a `self.key` that is not its signer's
 *   ed25519 public key, so the harness keys consensus nodes by their base64url public key while still
 *   addressing them by name everywhere a test reads. `buildLift`/`consensusNode`/`consensusStoreOf` all
 *   take the node NAME; the key↔name bijection lives inside the harness.
 * - **Pushes are fire-and-forget snapshots on the clock.** A push schedules a delivery timer and returns
 *   immediately (consensus reachability has a 2-cycle on every tally link, so awaiting the neighbour's
 *   `update` would recurse). So nothing settles until the clock is driven; `clock.pendingTimers === 0`
 *   at quiescence is the "no delivery left in flight" assertion, and `net.deliveryErrors` stays `[]` on
 *   a clean run (a receiver-side throw would land there, never back at the sender).
 * - **Latencies stay well under the code TTL.** A lift's codes are minted with the default 600_000 ms
 *   lifetime at `clock.now()` (= 0 on a fresh clock). The "sleeping node" / "slow third voter" cases
 *   use a 50_000 ms latency so no code expires mid-run (an expired code would make the woken node refuse
 *   and void the lift — a different outcome from the one under test).
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { base64urlToBytes, bytesToBase64url } from '../base64url.js'
import type { Signer, Verifier } from '../crypto.js'
import { makeNonce } from '../nonce.js'
import { generate } from '../session-code.js'
import type { TraceEvent } from '../trace.js'
import { signRecord } from '../consensus/signature.js'
import { DEFAULT_TTL, MAX_PENDING_COMMITS_PER_VOTER } from '../consensus/participant.js'
import type { ResourceContext, TrxParticipantResource } from '../consensus/resource.js'
import type { Signature, TrxRecord } from '../consensus/types.js'
import { DEFAULT_CONSENSUS_METHOD, MemberTypes, type DependentMember, type Link, type MemberType, type Plan, type UniQuery } from '../discovery/types.js'
import { VirtualClock } from './clock.js'
import { SeededRandom } from './random.js'
import {
	InMemoryNetwork,
	negateNumericTerms,
	type LinkCondition,
	type LiftMemberSpec,
	type LiftSpec,
	type NetworkGraph,
} from './network.js'

type Terms = { balance: number }
type Payload = { amount: string }

const PART: MemberType = MemberTypes.participant
const VOTER: MemberType = MemberTypes.voter
/** The opaque Taleus value every lift in this file carries. Only needs to round-trip the digest. */
const PAYLOAD: Payload = { amount: '100' }
/** A latency that spans the whole run yet stays far under the 600_000 ms default code lifetime. */
const SLOW_MS = 50_000

/* ── crypto doubles (deterministic ed25519, so a seeded run reproduces exactly) ──────────────────── */

/**
 * A signer whose secret is `sha256(seed ‖ name)`, so a `(seed, name)` pair always yields the same key
 * pair — and, since ed25519 signing is deterministic, the same signatures and the same trace stream
 * across two runs. `@noble/curves` is a devDependency; no curve enters the shipped harness.
 */
function makeSigner(seed: string, name: string): Signer {
	const secret = sha256(new TextEncoder().encode(`${seed}:${name}`))
	const publicKey = ed25519.getPublicKey(secret)
	return { publicKey, sign: (digest) => ed25519.sign(digest, secret) }
}

/** The per-node signer factory the harness takes, bound to one `seed`. */
function signerFor(seed: string): (name: string) => Signer {
	return (name) => makeSigner(seed, name)
}

/** A real ed25519 verifier honouring the Verifier contract (a malformed input is `false`, never a throw). */
const verifier: Verifier = {
	verify: (publicKey, digest, signature) => {
		try {
			return ed25519.verify(signature, digest, publicKey)
		} catch {
			return false
		}
	},
}

/** Flip the low bit of a signature's first value byte, keeping its length (verify fails rather than throws). */
function corrupt(signature: Signature): Signature {
	const bytes = base64urlToBytes(signature.value)
	bytes[0] ^= 0x01
	return { ...signature, value: bytesToBase64url(bytes) }
}

/** Flip the low bit of value byte `index` — distinct `index`es yield distinct garbage values (for the pool cap). */
function corruptAt(signature: Signature, index: number): Signature {
	const bytes = base64urlToBytes(signature.value)
	bytes[index % bytes.length] ^= 0x01
	return { ...signature, value: bytesToBase64url(bytes) }
}

/* ── resource doubles (one per node; the test reads back what each held/released) ────────────────── */

interface ResourceOpts {
	/** `acceptsProposal` gate value. Omitted → the hook is absent (engine defaults true → accepts). */
	acceptsProposal?: boolean
	/** `shouldPromise` gate value. Omitted → the hook is absent (engine defaults true → promises). */
	shouldPromise?: boolean
	/** `shouldCommit` gate value for a voter. Omitted → the hook is absent (engine defaults true → C). */
	shouldCommit?: boolean
}

interface ResourceDouble {
	resource: TrxParticipantResource<Terms, Payload>
	/** Contexts seen by `promise` (the hold). Empty ⇒ nothing was ever held. */
	promiseCtxs: ResourceContext<Terms, Payload>[]
	/** The `success` flag of each `release`. `[true]` = committed once; `[false]` = voided once; `[]` = never released. */
	releaseSuccesses: boolean[]
}

function makeResource(opts: ResourceOpts = {}): ResourceDouble {
	const promiseCtxs: ResourceContext<Terms, Payload>[] = []
	const releaseSuccesses: boolean[] = []
	const resource: TrxParticipantResource<Terms, Payload> = {
		promise: (ctx) => {
			promiseCtxs.push(ctx)
		},
		release: (ctx) => {
			releaseSuccesses.push(ctx.success)
		},
	}
	if (opts.acceptsProposal !== undefined) {
		resource.acceptsProposal = () => opts.acceptsProposal as boolean
	}
	if (opts.shouldPromise !== undefined) {
		resource.shouldPromise = () => opts.shouldPromise as boolean
	}
	if (opts.shouldCommit !== undefined) {
		resource.shouldCommit = () => opts.shouldCommit as boolean
	}
	return { resource, promiseCtxs, releaseSuccesses }
}

/** A per-node resource factory plus the doubles it minted, so a test can assert each node's releases. */
function resourceSet(specs: Record<string, ResourceOpts> = {}): {
	resourceFor: (name: string) => TrxParticipantResource<Terms, Payload>
	doubles: Map<string, ResourceDouble>
} {
	const doubles = new Map<string, ResourceDouble>()
	const resourceFor = (name: string): TrxParticipantResource<Terms, Payload> => {
		let double = doubles.get(name)
		if (!double) {
			double = makeResource(specs[name] ?? {})
			doubles.set(name, double)
		}
		return double.resource
	}
	return { resourceFor, doubles }
}

/* ── network + graph + lift helpers ──────────────────────────────────────────────────────────────── */

interface NetOpts {
	graph: NetworkGraph<Terms>
	seed?: string
	resourceSpecs?: Record<string, ResourceOpts>
	conditions?: Record<string, LinkCondition>
}

function makeNet(opts: NetOpts): {
	net: InMemoryNetwork<Terms, Payload>
	traces: TraceEvent[]
	doubles: Map<string, ResourceDouble>
} {
	const traces: TraceEvent[] = []
	const { resourceFor, doubles } = resourceSet(opts.resourceSpecs)
	const net = new InMemoryNetwork<Terms, Payload>({
		graph: opts.graph,
		clock: new VirtualClock(),
		random: new SeededRandom(1),
		invertTerms: negateNumericTerms,
		signerFor: signerFor(opts.seed ?? 'seed'),
		verifier,
		resourceFor,
		conditions: opts.conditions,
		trace: (event) => traces.push(event),
	})
	return { net, traces, doubles }
}

/** A graph from a node list and `[id, node1, node2]` edges, each carrying one `'L'` intent. */
function makeGraph(nodes: string[], edges: Array<[string, string, string]>): NetworkGraph<Terms> {
	return {
		nodes,
		links: edges.map(([id, node1, node2]) => ({ id, node1, node2, intents: { L: { balance: 100 } } })),
	}
}

/** A linear chain of `n` participants `P0..P{n-1}`; the last is also the sole voter. */
function linear(n: number): { names: string[]; graph: NetworkGraph<Terms>; members: LiftMemberSpec[] } {
	const names = Array.from({ length: n }, (_, i) => `P${i}`)
	const edges: Array<[string, string, string]> = names.slice(1).map((name, i) => [`e${i}`, names[i], name])
	const graph = makeGraph(names, edges)
	const members: LiftMemberSpec[] = names.map((name, i) => ({ name, roles: i === n - 1 ? [PART, VOTER] : [PART] }))
	return { names, graph, members }
}

/**
 * A plan built by hand (no discovery) over `linear(3)`'s P0—P1—P2 graph (edge ids `e0`, `e1`; P2 is
 * `[P,V]`), for the `proceed` tests that start a lift directly from a chosen plan. `proceed` never
 * ranks or discovers — it only mints the transaction code and folds the plan it is given — so a
 * hand-built plan exercises it exactly as a caller handing it `discover`'s `plans[0]` would.
 */
function handPlan(net: InMemoryNetwork<Terms, Payload>, randomSeed: number): { plan: Plan<Terms, Payload>; query: UniQuery<Terms> } {
	const sessionCode = generate(DEFAULT_TTL, { now: net.clock.now(), random: new SeededRandom(randomSeed) })
	const members: DependentMember[] = [
		{ types: [PART], address: { key: net.memberKey('P0') } },
		{ types: [PART], address: { key: net.memberKey('P1') } },
		{ types: [PART, VOTER], address: { key: net.memberKey('P2') } },
	]
	const path: Link<Terms>[] = [
		{ nonce: makeNonce(sessionCode, 'e0'), intents: { L: { balance: 100 } } },
		{ nonce: makeNonce(sessionCode, 'e1'), intents: { L: { balance: 100 } } },
	]
	const query: UniQuery<Terms> = {
		target: { address: { key: net.memberKey('P2') } },
		sessionCode,
		intents: { L: { balance: 100 } },
		maxDepth: 8,
		method: DEFAULT_CONSENSUS_METHOD,
	}
	return { plan: { members, path }, query }
}

/** Seed the originator and drive the clock to quiescence; returns the lift's transaction code. */
async function runLift(net: InMemoryNetwork<Terms, Payload>, spec: LiftSpec<Payload>): Promise<string> {
	const { record, transactionCode } = net.buildLift(spec)
	await net.consensusNode(spec.route[0]).start(record)
	await net.clock.runUntilIdle()
	return transactionCode
}

/** Every named node's settled outcome, in order. */
function outcomes(net: InMemoryNetwork<Terms, Payload>, names: string[], tx: string): Promise<Array<'commit' | 'void' | 'pending'>> {
	return Promise.all(names.map((name) => net.consensusNode(name).outcome(tx)))
}

/** The reasons of every `signature-rejected` trace event. */
function rejectReasons(traces: TraceEvent[]): string[] {
	return traces
		.filter((event): event is Extract<TraceEvent, { type: 'signature-rejected' }> => event.type === 'signature-rejected')
		.map((event) => event.reason)
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────── */

describe('consensus end to end — linear routes commit atomically', () => {
	for (const n of [3, 5, 8]) {
		it(`a ${n}-member chain commits everywhere, each node releasing once`, async () => {
			const { names, graph, members } = linear(n)
			const { net, doubles } = makeNet({ graph })
			const tx = await runLift(net, { members, route: names, payload: PAYLOAD })

			expect(await outcomes(net, names, tx)).toEqual(names.map(() => 'commit'))
			for (const name of names) {
				expect(doubles.get(name)!.releaseSuccesses).toEqual([true]) // released exactly once, success
			}
			expect(net.clock.pendingTimers).toBe(0)
			expect(net.deliveryErrors).toEqual([])
		})
	}
})

describe('consensus end to end — a refusal voids the whole route', () => {
	it('a participant that refuses to promise voids everywhere; every hold is released as failure', async () => {
		const { names, graph, members } = linear(3) // P0 (origin) — P1 (refuser) — P2 ([P,V])
		const { net, doubles, traces } = makeNet({ graph, resourceSpecs: { P1: { shouldPromise: false } } })
		const tx = await runLift(net, { members, route: names, payload: PAYLOAD })

		expect(await outcomes(net, names, tx)).toEqual(['void', 'void', 'void'])
		for (const name of names) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([false]) // released once, as a void
		}
		expect(doubles.get('P1')!.promiseCtxs).toEqual([]) // the refuser's gate declined → nothing was ever held
		expect(rejectReasons(traces)).toEqual([]) // an NP is a valid signature, not a rejected one
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})

	it('a middle participant that refuses the proposal (acceptsProposal=false) voids the whole route', async () => {
		const { names, graph, members } = linear(3) // P0 (origin) — P1 (proposal-refuser) — P2 ([P,V])
		const { net, doubles, traces } = makeNet({ graph, resourceSpecs: { P1: { acceptsProposal: false } } })
		const tx = await runLift(net, { members, route: names, payload: PAYLOAD })

		expect(await outcomes(net, names, tx)).toEqual(['void', 'void', 'void'])
		for (const name of names) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([false]) // released once, as a void
		}
		expect(doubles.get('P1')!.promiseCtxs).toEqual([]) // the proposal gate declined → nothing was ever held
		expect(rejectReasons(traces)).toEqual([]) // an NP is a valid signature, not a rejected one
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})

	it('a voter that votes no-commit voids everywhere', async () => {
		const graph = makeGraph(['A', 'B', 'R'], [['ab', 'A', 'B']])
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART], physical: true },
			{ name: 'B', roles: [PART], physical: true },
			{ name: 'R', roles: [VOTER], physical: true },
		]
		const { net, doubles } = makeNet({ graph, resourceSpecs: { R: { shouldCommit: false } } })
		const tx = await runLift(net, { members, route: ['A', 'B'], payload: PAYLOAD })

		expect(await outcomes(net, ['A', 'B', 'R'], tx)).toEqual(['void', 'void', 'void'])
		expect(doubles.get('A')!.releaseSuccesses).toEqual([false])
		expect(doubles.get('B')!.releaseSuccesses).toEqual([false])
		expect(doubles.get('R')!.releaseSuccesses).toEqual([false])
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})
})

describe('consensus end to end — circular lift', () => {
	it('a ring A→B→C→A (A the sole voter) commits and releases once at every node', async () => {
		const graph = makeGraph(
			['A', 'B', 'C'],
			[
				['ab', 'A', 'B'],
				['bc', 'B', 'C'],
				['ca', 'C', 'A'],
			],
		)
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART, VOTER] },
			{ name: 'B', roles: [PART] },
			{ name: 'C', roles: [PART] },
		]
		const { net, doubles } = makeNet({ graph })
		const tx = await runLift(net, { members, route: ['A', 'B', 'C', 'A'], payload: PAYLOAD })

		expect(await outcomes(net, ['A', 'B', 'C'], tx)).toEqual(['commit', 'commit', 'commit'])
		for (const name of ['A', 'B', 'C']) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([true])
		}
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})
})

describe('consensus end to end — dropped pushes', () => {
	it('a dropped push on one arm of a diamond still commits via the other arm', async () => {
		// A—B—D and A—C—D; the A—B edge is dropped. The record reaches voter D over the A→C→D arm; D's
		// commit returns to B over D—B. Every node commits; no node double-releases.
		const graph = makeGraph(
			['A', 'B', 'C', 'D'],
			[
				['ab', 'A', 'B'],
				['bd', 'B', 'D'],
				['ac', 'A', 'C'],
				['cd', 'C', 'D'],
			],
		)
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART] },
			{ name: 'B', roles: [PART] },
			{ name: 'C', roles: [PART] },
			{ name: 'D', roles: [PART, VOTER] },
		]
		const { net, doubles } = makeNet({ graph, conditions: { ab: { drop: true } } })
		const tx = await runLift(net, { members, route: ['A', 'B', 'D'], extraLinks: [['A', 'C'], ['C', 'D']], payload: PAYLOAD })

		expect(await outcomes(net, ['A', 'B', 'C', 'D'], tx)).toEqual(['commit', 'commit', 'commit', 'commit'])
		for (const name of ['A', 'B', 'C', 'D']) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([true])
		}
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})

	it('a dropped push on the only path stalls — no node settles, none falsely commits', async () => {
		const graph = makeGraph(
			['A', 'B', 'T'],
			[
				['ab', 'A', 'B'],
				['bt', 'B', 'T'],
			],
		)
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART] },
			{ name: 'B', roles: [PART] },
			{ name: 'T', roles: [PART, VOTER] },
		]
		const { net, doubles } = makeNet({ graph, conditions: { ab: { drop: true } } })
		const tx = await runLift(net, { members, route: ['A', 'B', 'T'], payload: PAYLOAD })

		expect(await outcomes(net, ['A', 'B', 'T'], tx)).toEqual(['pending', 'pending', 'pending'])
		for (const name of ['A', 'B', 'T']) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([]) // nothing settled → nothing released
		}
		expect(net.clock.pendingTimers).toBe(0) // a dropped push arms no timer; nothing leaks
		expect(net.deliveryErrors).toEqual([])
	})
})

describe('consensus end to end — a sleeping node', () => {
	it('settlement waits for a node reached only over a slow link, then commits everywhere', async () => {
		const graph = makeGraph(
			['A', 'B', 'C'],
			[
				['ab', 'A', 'B'],
				['bc', 'B', 'C'],
			],
		)
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART] },
			{ name: 'B', roles: [PART] },
			{ name: 'C', roles: [PART, VOTER] },
		]
		const { net, doubles } = makeNet({ graph, conditions: { bc: { latencyMs: SLOW_MS } } })
		const { record, transactionCode: tx } = net.buildLift({ members, route: ['A', 'B', 'C'], payload: PAYLOAD })

		await net.consensusNode('A').start(record)
		await net.clock.advance(SLOW_MS / 5) // before C's inbound delivery fires — the route cannot have settled
		expect(await outcomes(net, ['A', 'B', 'C'], tx)).toEqual(['pending', 'pending', 'pending'])

		await net.clock.runUntilIdle() // the sleeper wakes; its promise + vote fold in and the commit diffuses back
		expect(await outcomes(net, ['A', 'B', 'C'], tx)).toEqual(['commit', 'commit', 'commit'])
		for (const name of ['A', 'B', 'C']) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([true])
		}
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})
})

describe('consensus end to end — voter set sizes', () => {
	/** Two participants plus `refs` voter-only members, all with a physical address for complete reachability. */
	function voterSet(refs: string[]) {
		const nodes = ['A', 'B', ...refs]
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART], physical: true },
			{ name: 'B', roles: [PART], physical: true },
			...refs.map((name) => ({ name, roles: [VOTER], physical: true })),
		]
		return { nodes, members, graph: makeGraph(nodes, [['ab', 'A', 'B']]) }
	}

	it('a set of one commits the route', async () => {
		const { nodes, members, graph } = voterSet(['R'])
		const { net, doubles } = makeNet({ graph })
		const tx = await runLift(net, { members, route: ['A', 'B'], payload: PAYLOAD })
		expect(await outcomes(net, nodes, tx)).toEqual(nodes.map(() => 'commit'))
		for (const name of nodes) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([true])
		}
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('a set of two that both commit reaches a strict majority and commits', async () => {
		const { nodes, members, graph } = voterSet(['R1', 'R2'])
		const { net, doubles } = makeNet({ graph })
		const tx = await runLift(net, { members, route: ['A', 'B'], payload: PAYLOAD })
		expect(await outcomes(net, nodes, tx)).toEqual(nodes.map(() => 'commit'))
		for (const name of nodes) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([true])
		}
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('a set of two that splits one commit / one void settles neither way (stall)', async () => {
		const { nodes, members, graph } = voterSet(['R1', 'R2'])
		const { net, doubles } = makeNet({ graph, resourceSpecs: { R2: { shouldCommit: false } } })
		const tx = await runLift(net, { members, route: ['A', 'B'], payload: PAYLOAD })
		expect(await outcomes(net, nodes, tx)).toEqual(nodes.map(() => 'pending')) // even split → no strict majority
		for (const name of nodes) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([]) // nothing settled in-band
		}
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('a set of three commits on the two fast votes while the third voter is still asleep, then that one commits too', async () => {
		// R3 is reached only over a slow link from B; R1 + R2 (fast, physical) are a strict majority on their own.
		const nodes = ['A', 'B', 'R1', 'R2', 'R3']
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART], physical: true },
			{ name: 'B', roles: [PART], physical: true },
			{ name: 'R1', roles: [VOTER], physical: true },
			{ name: 'R2', roles: [VOTER], physical: true },
			{ name: 'R3', roles: [VOTER] }, // NOT physical — reached only over the slow B—R3 edge
		]
		const graph = makeGraph(nodes, [['ab', 'A', 'B'], ['br3', 'B', 'R3']])
		const { net, doubles } = makeNet({ graph, conditions: { br3: { latencyMs: SLOW_MS } } })
		const { record, transactionCode: tx } = net.buildLift({ members, route: ['A', 'B'], extraLinks: [['B', 'R3']], payload: PAYLOAD })

		await net.consensusNode('A').start(record)
		await net.clock.advance(SLOW_MS / 5) // the fast four have settled; R3's delivery has not fired yet
		expect(await outcomes(net, ['A', 'B', 'R1', 'R2'], tx)).toEqual(['commit', 'commit', 'commit', 'commit'])
		expect(await net.consensusNode('R3').outcome(tx)).toBe('pending')
		expect(doubles.get('R3')!.releaseSuccesses).toEqual([])

		await net.clock.runUntilIdle()
		expect(await outcomes(net, nodes, tx)).toEqual(nodes.map(() => 'commit'))
		for (const name of nodes) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([true]) // R3 folds in and releases once, on the same commit
		}
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})
})

describe('consensus end to end — delivery lifecycle', () => {
	it('re-delivering a settled record is a no-op: no second release', async () => {
		const { names, graph, members } = linear(3)
		const { net, doubles } = makeNet({ graph })
		const tx = await runLift(net, { members, route: names, payload: PAYLOAD })

		const settled = await net.consensusStoreOf('P0').getRecord(tx)
		expect(settled).toBeDefined()
		await net.consensusNode('P0').update(settled!) // the whole settled record arrives again
		await net.clock.runUntilIdle()

		expect(doubles.get('P0')!.releaseSuccesses).toEqual([true]) // still exactly one release
		expect(await net.consensusNode('P0').outcome(tx)).toBe('commit')
		expect(net.clock.pendingTimers).toBe(0)
	})
})

describe('consensus end to end — adversarial signatures cannot flip a route', () => {
	it('a post-commit equivocating voter is refused; the settled commit stands and no one re-releases', async () => {
		const seed = 'equivocate'
		const graph = makeGraph(['A', 'B', 'R'], [['ab', 'A', 'B']])
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART], physical: true },
			{ name: 'B', roles: [PART], physical: true },
			{ name: 'R', roles: [VOTER], physical: true },
		]
		const { net, doubles, traces } = makeNet({ graph, seed })
		const tx = await runLift(net, { members, route: ['A', 'B'], payload: PAYLOAD })
		expect(await net.consensusNode('A').outcome(tx)).toBe('commit')

		// The voter now signs the opposite face (NC) over the same, complete promise set and we deliver it.
		const settled = await net.consensusStoreOf('A').getRecord(tx)
		const refVoid = await signRecord(makeSigner(seed, 'R'), 'NC', settled!)
		await net.consensusNode('A').update({ ...settled!, commits: [refVoid] })
		await net.clock.runUntilIdle()

		expect(rejectReasons(traces)).toContain('equivocation') // the second face is refused; the first stands
		expect(await net.consensusNode('A').outcome(tx)).toBe('commit')
		expect(doubles.get('A')!.releaseSuccesses).toEqual([true]) // still exactly one release
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('a forged voter commit is dropped; the genuine majority still reads as a commit', async () => {
		// An observer X (not a member, so it only merges and classifies) is handed a complete-promise record
		// carrying two genuine voter commits and one forged one. The forged commit fails verification once the
		// promise phase is complete and is dropped; two of three genuine votes are a strict majority → commit.
		const seed = 'forge'
		const graph = makeGraph(['A', 'B', 'R1', 'R2', 'R3', 'X'], [['ab', 'A', 'B']])
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART] },
			{ name: 'B', roles: [PART] },
			{ name: 'R1', roles: [VOTER] },
			{ name: 'R2', roles: [VOTER] },
			{ name: 'R3', roles: [VOTER] },
		]
		const { net, traces, doubles } = makeNet({ graph, seed })
		const { record, transactionCode: tx } = net.buildLift({ members, route: ['A', 'B'], payload: PAYLOAD })

		const complete: TrxRecord<Terms, Payload> = {
			...record,
			promises: [await signRecord(makeSigner(seed, 'A'), 'P', record), await signRecord(makeSigner(seed, 'B'), 'P', record)],
		}
		const r1Commit = await signRecord(makeSigner(seed, 'R1'), 'C', complete)
		const r2Commit = await signRecord(makeSigner(seed, 'R2'), 'C', complete)
		const r3Forged = corrupt(await signRecord(makeSigner(seed, 'R3'), 'C', complete))

		await net.consensusNode('X').update({ ...complete, commits: [r1Commit, r2Commit, r3Forged] })
		await net.clock.runUntilIdle()

		expect(rejectReasons(traces)).toContain('forged')
		expect(await net.consensusNode('X').outcome(tx)).toBe('commit') // 2 of 3 genuine voters
		expect(doubles.get('X')!.releaseSuccesses).toEqual([]) // X is a relay — it classifies but never acts
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})
})

describe('consensus end to end — a forged commit cannot shadow a genuine vote (pre-promise pool)', () => {
	// An observer X (NOT a member, so it only merges + classifies, never acts) receives a commit-phase
	// signature BEFORE the promise phase completes — the window the forged-commit-shadows-vote defect lived
	// in. The fix holds every unverifiable commit in a durable side pool until the promise set is complete,
	// so a forged (or honestly out-of-order) commit can neither block nor silence the genuine one. R is the
	// SOLE voter: a silenced vote would leave the route at `pending` (no majority), so `commit` proves it
	// survived. (Keep the post-commit equivocation test above too — this block exercises the pre-promise path.)
	const seed = 'pool'
	const graph = makeGraph(['A', 'B', 'R', 'X'], [['ab', 'A', 'B']])
	const members: LiftMemberSpec[] = [
		{ name: 'A', roles: [PART] },
		{ name: 'B', roles: [PART] },
		{ name: 'R', roles: [VOTER] },
	]

	/** The record with both participant promises merged — the complete set a commit binds and verifies against. */
	async function completeOf(record: TrxRecord<Terms, Payload>): Promise<TrxRecord<Terms, Payload>> {
		const promises = [await signRecord(makeSigner(seed, 'A'), 'P', record), await signRecord(makeSigner(seed, 'B'), 'P', record)]
		return { ...record, promises }
	}

	it('a garbage C injected before the promises does not silence the genuine vote (headline regression)', async () => {
		const { net, traces, doubles } = makeNet({ graph, seed })
		const { record, transactionCode: tx } = net.buildLift({ members, route: ['A', 'B'], payload: PAYLOAD })
		const complete = await completeOf(record)
		const genuineC = await signRecord(makeSigner(seed, 'R'), 'C', complete)
		const garbage = corrupt(genuineC)

		// Delivery 1: the garbage commit arrives with no promises → X pools it (cannot verify it yet).
		await net.consensusNode('X').update({ ...record, promises: [], commits: [garbage] })
		await net.clock.runUntilIdle()
		expect(await net.consensusNode('X').outcome(tx)).toBe('pending') // nothing counted yet

		// Delivery 2: the promises complete and the genuine vote arrives → the garbage drains (forged), the
		// genuine C verifies and counts → commit. (Under the old code this read `pending`, reject `changed`.)
		await net.consensusNode('X').update({ ...complete, commits: [genuineC] })
		await net.clock.runUntilIdle()

		expect(rejectReasons(traces)).toContain('forged')
		expect(rejectReasons(traces)).not.toContain('changed')
		expect(rejectReasons(traces)).not.toContain('equivocation')
		expect(await net.consensusNode('X').outcome(tx)).toBe('commit') // the genuine vote stood
		expect(doubles.get('X')!.releaseSuccesses).toEqual([]) // X is a relay — it classifies but never acts
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})

	it('a garbage opposite-face NC injected before the promises does not collide with the genuine C', async () => {
		const { net, traces } = makeNet({ graph, seed })
		const { record, transactionCode: tx } = net.buildLift({ members, route: ['A', 'B'], payload: PAYLOAD })
		const complete = await completeOf(record)
		const genuineC = await signRecord(makeSigner(seed, 'R'), 'C', complete)
		const garbageNC = corrupt(await signRecord(makeSigner(seed, 'R'), 'NC', complete))

		await net.consensusNode('X').update({ ...record, promises: [], commits: [garbageNC] })
		await net.consensusNode('X').update({ ...complete, commits: [genuineC] })
		await net.clock.runUntilIdle()

		expect(rejectReasons(traces)).toContain('forged')
		expect(rejectReasons(traces)).not.toContain('equivocation')
		expect(await net.consensusNode('X').outcome(tx)).toBe('commit')
		expect(net.deliveryErrors).toEqual([])
	})

	it('an honest out-of-order early commit is pooled, then counts once the promises complete', async () => {
		const { net, traces } = makeNet({ graph, seed })
		const { record, transactionCode: tx } = net.buildLift({ members, route: ['A', 'B'], payload: PAYLOAD })
		const complete = await completeOf(record)
		const genuineC = await signRecord(makeSigner(seed, 'R'), 'C', complete)
		const aliceP = complete.promises[0] // A's promise only — the set is still incomplete without B's

		// Delivery 1: R's GENUINE commit, but only one promise present → pooled (cannot verify it yet).
		await net.consensusNode('X').update({ ...record, promises: [aliceP], commits: [genuineC] })
		expect(await net.consensusNode('X').outcome(tx)).toBe('pending')

		// Delivery 2: the completing promises only — NOT re-carrying the commit → the pooled commit drains,
		// verifies, and counts.
		await net.consensusNode('X').update({ ...complete, commits: [] })
		await net.clock.runUntilIdle()

		expect(rejectReasons(traces)).toEqual([]) // nothing forged; the honest commit simply waited its turn
		expect(await net.consensusNode('X').outcome(tx)).toBe('commit')
		expect(net.deliveryErrors).toEqual([])
	})

	it('a genuine equivocation pooled before the promises resolves to the earliest face on drain', async () => {
		const { net, traces } = makeNet({ graph, seed })
		const { record, transactionCode: tx } = net.buildLift({ members, route: ['A', 'B'], payload: PAYLOAD })
		const complete = await completeOf(record)
		const refCommit = await signRecord(makeSigner(seed, 'R'), 'C', complete)
		const refVoid = await signRecord(makeSigner(seed, 'R'), 'NC', complete)

		// Both verifying faces pooled pre-promise, commit first; the promises then complete (commit not re-carried).
		await net.consensusNode('X').update({ ...record, promises: [], commits: [refCommit, refVoid] })
		await net.consensusNode('X').update({ ...complete, commits: [] })
		await net.clock.runUntilIdle()

		expect(rejectReasons(traces)).toContain('equivocation') // the later (second) face is refused on drain
		expect(await net.consensusNode('X').outcome(tx)).toBe('commit') // the earliest face (C) stands
		expect(net.deliveryErrors).toEqual([])
	})

	it('caps the pool per voter: pre-promise overflow drops as pool-full, the genuine vote still counts', async () => {
		const { net, traces } = makeNet({ graph, seed })
		const { record, transactionCode: tx } = net.buildLift({ members, route: ['A', 'B'], payload: PAYLOAD })
		const complete = await completeOf(record)
		const genuineC = await signRecord(makeSigner(seed, 'R'), 'C', complete)
		// One past the cap, all DISTINCT (distinct byte flips) for the one voter → the final one overflows.
		const garbage = Array.from({ length: MAX_PENDING_COMMITS_PER_VOTER + 1 }, (_, i) => corruptAt(genuineC, i))

		await net.consensusNode('X').update({ ...record, promises: [], commits: garbage })
		await net.consensusNode('X').update({ ...complete, commits: [genuineC] })
		await net.clock.runUntilIdle()

		expect(rejectReasons(traces)).toContain('pool-full') // the overflow was refused, never pooled
		expect(await net.consensusNode('X').outcome(tx)).toBe('commit') // the cap did not lock out the real vote
		expect(net.deliveryErrors).toEqual([])
	})
})

describe('buildLift — routeLinkIds disambiguates parallel tallies', () => {
	// Two parallel edges between A and B carrying DISTINCT link terms. Without routeLinkIds the first edge
	// (ab1) is taken; with routeLinkIds: ['ab2'] the second one is, proving the exact-tally selection the
	// simulator needs when a pair holds more than one tally.
	const members: LiftMemberSpec[] = [
		{ name: 'A', roles: [PART] },
		{ name: 'B', roles: [PART, VOTER] },
	]
	const parallel: NetworkGraph<Terms> = {
		nodes: ['A', 'B'],
		links: [
			{ id: 'ab1', node1: 'A', node2: 'B', intents: { L: { balance: 11 } } },
			{ id: 'ab2', node1: 'A', node2: 'B', intents: { L: { balance: 22 } } },
		],
	}

	it('selects the named parallel edge (ab2), not the first (ab1)', () => {
		const { net } = makeNet({ graph: parallel })
		const { record, sessionCode } = net.buildLift({ members, route: ['A', 'B'], routeLinkIds: ['ab2'], payload: PAYLOAD })
		const nonce = makeNonce(sessionCode, 'ab2')
		expect(Object.keys(record.topology.links)).toEqual([nonce])
		expect(record.topology.links[nonce].intents.L.balance).toBe(22) // ab2's terms, not ab1's 11
	})

	it('without routeLinkIds, the first edge to the neighbour (ab1) is taken — behaviour unchanged', () => {
		const { net } = makeNet({ graph: parallel })
		const { record, sessionCode } = net.buildLift({ members, route: ['A', 'B'], payload: PAYLOAD })
		const nonce = makeNonce(sessionCode, 'ab1')
		expect(Object.keys(record.topology.links)).toEqual([nonce])
		expect(record.topology.links[nonce].intents.L.balance).toBe(11)
	})

	it('throws when routeLinkIds length does not match the number of route hops', () => {
		const { net } = makeNet({ graph: parallel })
		expect(() => net.buildLift({ members, route: ['A', 'B'], routeLinkIds: ['ab1', 'ab2'], payload: PAYLOAD })).toThrow(/routeLinkIds/)
	})

	it('throws when a routeLinkId does not name an edge to the given neighbour', () => {
		const { net } = makeNet({ graph: parallel })
		expect(() => net.buildLift({ members, route: ['A', 'B'], routeLinkIds: ['nope'], payload: PAYLOAD })).toThrow(/no graph link nope/)
	})
})

describe('consensus end to end — originator proceed / abort', () => {
	it('proceed starts a lift from a hand-built plan; it commits everywhere, each node releasing once', async () => {
		const { names, graph } = linear(3)
		const { net, doubles } = makeNet({ graph })
		const { plan, query } = handPlan(net, 99)

		const record = await net.consensusNode('P0').proceed({ plan, query, payload: PAYLOAD })
		expect(record.promises.some((signature) => signature.type === 'P' && signature.address === net.memberKey('P0'))).toBe(true)

		await net.clock.runUntilIdle()

		expect(await outcomes(net, names, record.transactionCode)).toEqual(names.map(() => 'commit'))
		for (const name of names) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([true])
		}
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})

	it('abort voids a seeded-but-unpromised record; every node, including the originator, releases as failure', async () => {
		const { names, graph, members } = linear(3)
		const { net, doubles } = makeNet({ graph })
		const { record, transactionCode: tx } = net.buildLift({ members, route: names, payload: PAYLOAD })
		expect(record.promises).toEqual([])

		await net.consensusStoreOf('P0').saveRecord(record)
		await net.consensusNode('P0').abort(tx)
		await net.clock.runUntilIdle()

		expect(await outcomes(net, names, tx)).toEqual(names.map(() => 'void'))
		for (const name of names) {
			// Including the originator: abort signs our own NP and routes it through update, so P0
			// releases its own (empty) hold as a failure exactly as a refusing participant does.
			expect(doubles.get(name)!.releaseSuccesses).toEqual([false])
		}
		const stored = await net.consensusStoreOf('P0').getRecord(tx)
		expect(stored!.promises.some((signature) => signature.type === 'NP' && signature.address === net.memberKey('P0'))).toBe(true)
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})

	it('abort is refused once every participant has promised — no-op, the settled commit stands', async () => {
		// Note: for the originator this reaches abort's `isReleased` (already-settled) guard — runLift
		// drives P0 to commit AND release before we abort, so the earlier guard fires. The distinct
		// promise-phase-complete guard (complete promises, not yet released) is exercised below.
		const { names, graph, members } = linear(3)
		const { net, doubles } = makeNet({ graph })
		const tx = await runLift(net, { members, route: names, payload: PAYLOAD })
		const before = await net.consensusStoreOf('P0').getRecord(tx)
		expect(await net.consensusNode('P0').outcome(tx)).toBe('commit')

		await net.consensusNode('P0').abort(tx)
		await net.clock.runUntilIdle()

		const after = await net.consensusStoreOf('P0').getRecord(tx)
		expect(after!.promises).toEqual(before!.promises) // no NP appended
		expect(await net.consensusNode('P0').outcome(tx)).toBe('commit')
		expect(doubles.get('P0')!.releaseSuccesses).toEqual([true]) // no second release
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('abort no-ops on a fully-promised but unreleased record (the promise-phase-complete guard)', async () => {
		// Seed a record whose promise phase is already complete (every participant signed P) but which
		// has not settled or released — the one state that reaches abort's promise-phase-complete guard
		// distinctly from the already-settled guard (cases above) and the atomicity guard (case below).
		const { names, graph, members } = linear(3)
		const { net, doubles } = makeNet({ graph })
		const { record, transactionCode: tx } = net.buildLift({ members, route: names, payload: PAYLOAD })
		for (const name of names) {
			record.promises.push(await signRecord(makeSigner('seed', name), 'P', record)) // a promise preimage ignores the promise set, so order is irrelevant
		}
		await net.consensusStoreOf('P0').saveRecord(record)

		await net.consensusNode('P0').abort(tx)
		await net.clock.runUntilIdle()

		const stored = await net.consensusStoreOf('P0').getRecord(tx)
		expect(stored!.promises.some((signature) => signature.type === 'NP')).toBe(false) // refused: no NP appended
		expect(stored!.promises).toHaveLength(names.length) // promise set untouched
		expect(doubles.get('P0')!.releaseSuccesses).toEqual([]) // nothing released
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('abort is refused once we have already signed our own P (atomicity guard) — no second release', async () => {
		const { graph } = linear(3)
		const { net, doubles } = makeNet({ graph })
		const { plan, query } = handPlan(net, 7)

		const record = await net.consensusNode('P0').proceed({ plan, query, payload: PAYLOAD })
		await net.clock.runUntilIdle()
		expect(await net.consensusNode('P0').outcome(record.transactionCode)).toBe('commit')

		await net.consensusNode('P0').abort(record.transactionCode)
		await net.clock.runUntilIdle()

		expect(await net.consensusNode('P0').outcome(record.transactionCode)).toBe('commit')
		expect(doubles.get('P0')!.releaseSuccesses).toEqual([true]) // unchanged — abort is a no-op
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('abort no-ops on an unknown transaction code', async () => {
		const { graph } = linear(3)
		const { net, doubles } = makeNet({ graph })

		await net.consensusNode('P0').abort('not-a-real-transaction-code')
		await net.clock.runUntilIdle()

		expect(doubles.get('P0')!.releaseSuccesses).toEqual([])
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('abort no-ops on an already-settled transaction — no second release', async () => {
		const { names, graph, members } = linear(3)
		const { net, doubles } = makeNet({ graph })
		const tx = await runLift(net, { members, route: names, payload: PAYLOAD })
		expect(await net.consensusNode('P0').outcome(tx)).toBe('commit')

		await net.consensusNode('P0').abort(tx)
		await net.clock.runUntilIdle()

		expect(await net.consensusNode('P0').outcome(tx)).toBe('commit')
		expect(doubles.get('P0')!.releaseSuccesses).toEqual([true]) // unchanged
		expect(net.clock.pendingTimers).toBe(0)
	})
})

describe('consensus end to end — determinism', () => {
	it('two runs from the same seed and codes produce byte-identical trace streams', async () => {
		// Same keys (seed-derived) + same codes (seeded mint) + same topology ⇒ identical signatures, identical
		// push scheduling, identical fire order — so the whole TraceEvent stream reproduces. This is the
		// reproducibility contract tallysim-consensus relies on.
		const sessionCode = generate(600_000, { now: 0, random: new SeededRandom(42) })
		const transactionCode = generate(600_000, { now: 1, random: new SeededRandom(43) })

		async function capture(): Promise<TraceEvent[]> {
			const { names, graph, members } = linear(3)
			const { net, traces } = makeNet({ graph, seed: 'determinism' })
			await runLift(net, { members, route: names, payload: PAYLOAD, sessionCode, transactionCode })
			return traces
		}

		const first = await capture()
		const second = await capture()
		expect(first.length).toBeGreaterThan(0)
		expect(second).toEqual(first)
	})
})
