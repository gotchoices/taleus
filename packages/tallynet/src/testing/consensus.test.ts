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
import { DEFAULT_CONSENSUS_METHOD, MemberTypes, type DependentMember, type Link, type MemberType, type Plan, type Target, type UniQuery } from '../discovery/types.js'
import { VirtualClock } from './clock.js'
import { SeededRandom } from './random.js'
import {
	InMemoryNetwork,
	negateNumericTerms,
	type LinkCondition,
	type LiftMemberSpec,
	type LiftSpec,
	type NetworkGraph,
	type RefereeNomination,
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
	/** Per-node referee nominations, threaded straight into the network so a real `discover` folds them in. */
	nomineesFor?: (nodeId: string) => RefereeNomination[]
	/** A member that refuses to relay (and serve) the commit phase — the interior refuser a pull must route around. */
	refuseRelay?: (nodeId: string) => boolean
	/** A member that goes silent (sends/receives/serves no commit phase) once it has promised. */
	silentAfterPromise?: (nodeId: string) => boolean
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
		nomineesFor: opts.nomineesFor,
		refuseRelay: opts.refuseRelay,
		silentAfterPromise: opts.silentAfterPromise,
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
		// The holders' deadline timers fire once (one-shot) at ~expiry+grace and no-op — each holds an incomplete
		// promise set, so none can void unilaterally — and the voter never received a record, so the heap drains
		// to 0 and no node falsely settles.
		expect(net.clock.pendingTimers).toBe(0)
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

describe('consensus end to end — a discovered referee reaches the vote count (real plan, no shortcut)', () => {
	// The headline the regression check asked for: a voter nominated *during a real route search* travels
	// discovery → topology → the vote count, with no buildLift spec shortcut for the voter set. Every member
	// a real `discover` emits is `[P]` (see makeFindAddress), so the ONLY way a `[V]` member enters a
	// discovered plan is a participant's `dependsOn` nomination — which makes the nominated referee the
	// *sole* voter and gives us clean outcome control. The referee rides no tally link; its vote reaches the
	// originator over the originator's stamped contact point.
	const PAYEE: Target = { address: { key: 'Z' } }
	const INTENTS: Record<string, Terms> = { L: { balance: 100 } }

	/** The line O—A—B—Z plus an edge-less R; nominated by whichever nodes `nomineesFor` names. */
	function lineToZ(): NetworkGraph<Terms> {
		return makeGraph(['O', 'A', 'B', 'Z', 'R'], [['oa', 'O', 'A'], ['ab', 'A', 'B'], ['bz', 'B', 'Z']])
	}

	/** Run a real search O→Z, driving the clock to settle it, and return the chosen plan + a mint query. */
	async function searchToZ(net: InMemoryNetwork<Terms, Payload>): Promise<{ plan: Plan<Terms, Payload>; query: UniQuery<Terms> }> {
		const search = net.discover('O', PAYEE, INTENTS)
		await net.clock.runUntilIdle()
		const result = await search
		expect(result.plans.length).toBeGreaterThan(0) // the route must be found for the mint to mean anything
		const query: UniQuery<Terms> = {
			target: PAYEE,
			sessionCode: result.sessionCode,
			intents: INTENTS,
			maxDepth: 7,
			method: DEFAULT_CONSENSUS_METHOD,
		}
		return { plan: result.plans[0], query }
	}

	/** Whether any topology link touches `key` as a source or target. */
	function ridesALink(record: TrxRecord<Terms, Payload>, key: string): boolean {
		return Object.values(record.topology.links).some((link) => link.source === key || link.target === key)
	}

	it('a referee nominated mid-search is a V member riding no link, and its lone C commits the whole route', async () => {
		const { net } = makeNet({ graph: lineToZ(), nomineesFor: (name) => (name === 'A' ? [{ name: 'R' }] : []) })
		const { plan, query } = await searchToZ(net)
		const { record, transactionCode: tx } = net.mintFromPlan('O', query, plan, PAYLOAD)
		await net.consensusNode('O').start(record)
		await net.clock.runUntilIdle()

		const refKey = net.memberKey('R')
		const refMember = record.topology.members.find((member) => member.address.key === refKey)
		expect(refMember).toBeDefined()
		expect(refMember!.types).toContain(VOTER) // folded in as a voter through prependMatch, from A's dependsOn
		expect(record.topology.members.filter((member) => member.types.includes(VOTER))).toHaveLength(1) // R is the sole voter
		expect(ridesALink(record, refKey)).toBe(false) // a referee rides no tally edge
		expect(await outcomes(net, ['O', 'A', 'B', 'Z', 'R'], tx)).toEqual(['commit', 'commit', 'commit', 'commit', 'commit'])
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})

	it("the referee's NC flips the outcome: as the sole voter, its no-commit voids the whole route", async () => {
		const { net } = makeNet({
			graph: lineToZ(),
			nomineesFor: (name) => (name === 'A' ? [{ name: 'R' }] : []),
			resourceSpecs: { R: { shouldCommit: false } },
		})
		const { plan, query } = await searchToZ(net)
		const { record, transactionCode: tx } = net.mintFromPlan('O', query, plan, PAYLOAD)
		await net.consensusNode('O').start(record)
		await net.clock.runUntilIdle()

		expect(await outcomes(net, ['O', 'A', 'B', 'Z', 'R'], tx)).toEqual(['void', 'void', 'void', 'void', 'void'])
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})

	it('nominated by two participants, the referee is folded in once and counted once (still commits)', async () => {
		const { net } = makeNet({
			graph: lineToZ(),
			nomineesFor: (name) => (name === 'A' || name === 'B' ? [{ name: 'R' }] : []),
		})
		const { plan, query } = await searchToZ(net)
		const { record, transactionCode: tx } = net.mintFromPlan('O', query, plan, PAYLOAD)
		await net.consensusNode('O').start(record)
		await net.clock.runUntilIdle()

		const voters = record.topology.members.filter((member) => member.types.includes(VOTER))
		expect(voters).toHaveLength(1) // prependMatch de-duped the two nominations into one member
		expect(voters[0].address.key).toBe(net.memberKey('R'))
		// If R were double-weighted the voter set would be size 2, its single counted vote (commits dedupe by
		// address) would be 1/2 — no majority — and the route would stay `pending`. `commit` proves single weight.
		expect(await outcomes(net, ['O', 'A', 'B', 'Z', 'R'], tx)).toEqual(['commit', 'commit', 'commit', 'commit', 'commit'])
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})

	it('two participants nominating distinct referees assemble a two-voter set through the real search, and commit', async () => {
		// The one real-`discover` shape the single-referee tests above cannot reach: a *multi-voter* set
		// assembled by discovery. A folds in R1, B folds in R2 — two different nominees, so prependMatch
		// appends each as its own missing member (not the de-dup/upgrade path of the "nominated by two" test).
		// Both commit → strict 2/2 majority → the whole route commits, proving the folding of multiple distinct
		// discovered voters and the majority count over them (the stall side of that count lives in the
		// buildLift "voter set sizes" tests, which already cover a 1/2 split settling neither way).
		const graph = makeGraph(['O', 'A', 'B', 'Z', 'R1', 'R2'], [['oa', 'O', 'A'], ['ab', 'A', 'B'], ['bz', 'B', 'Z']])
		const { net } = makeNet({
			graph,
			nomineesFor: (name) => (name === 'A' ? [{ name: 'R1' }] : name === 'B' ? [{ name: 'R2' }] : []),
		})
		const { plan, query } = await searchToZ(net)
		const { record, transactionCode: tx } = net.mintFromPlan('O', query, plan, PAYLOAD)
		await net.consensusNode('O').start(record)
		await net.clock.runUntilIdle()

		const voterKeys = record.topology.members.filter((member) => member.types.includes(VOTER)).map((member) => member.address.key)
		expect(voterKeys).toHaveLength(2) // two distinct referees, each folded in once
		expect(new Set(voterKeys)).toEqual(new Set([net.memberKey('R1'), net.memberKey('R2')]))
		expect(await outcomes(net, ['O', 'A', 'B', 'Z', 'R1', 'R2'], tx)).toEqual(['commit', 'commit', 'commit', 'commit', 'commit', 'commit'])
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})

	it('a circular originator (payee = self) mints a valid two-link ring and commits (hand-built plan)', async () => {
		// A real `discover` toward literally-self degenerates to a round-0 self-match (path:[], members:[O];
		// see discovery.test.ts "self is the target") — no ring path. So the circular case is built by hand
		// and fed through mintFromPlan, which proves the two-link mint shape settles. A 2-node ring needs two
		// PARALLEL edges: makeNonce depends only on the link id, so one edge would collide both ring links.
		const graph: NetworkGraph<Terms> = {
			nodes: ['O', 'X'],
			links: [
				{ id: 'ox1', node1: 'O', node2: 'X', intents: { L: { balance: 100 } } },
				{ id: 'ox2', node1: 'O', node2: 'X', intents: { L: { balance: 100 } } },
			],
		}
		const { net } = makeNet({ graph })
		const session = generate(DEFAULT_TTL, { now: net.clock.now(), random: new SeededRandom(5) })
		const plan: Plan<Terms, Payload> = {
			members: [
				{ types: [PART, VOTER], address: { key: 'O' } },
				{ types: [PART], address: { key: 'X' } },
			],
			path: [
				{ nonce: makeNonce(session, 'ox1'), intents: { L: { balance: 100 } } },
				{ nonce: makeNonce(session, 'ox2'), intents: { L: { balance: 100 } } },
			],
		}
		const query: UniQuery<Terms> = {
			target: { address: { key: 'O' } },
			sessionCode: session,
			intents: INTENTS,
			maxDepth: 8,
			method: DEFAULT_CONSENSUS_METHOD,
		}
		const { record, transactionCode: tx } = net.mintFromPlan('O', query, plan, PAYLOAD)
		expect(Object.keys(record.topology.links)).toHaveLength(2) // ring: O→X (ox1) and X→O (ox2)

		await net.consensusNode('O').start(record)
		await net.clock.runUntilIdle()

		expect(await outcomes(net, ['O', 'X'], tx)).toEqual(['commit', 'commit'])
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
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

describe('consensus end to end — record availability (a pull routes around a refuser)', () => {
	it('a linear chain with contact points: an interior refuser cuts the far member off from the push, but a pull settles it', async () => {
		// O—V—R—F. V (the sole voter) and O publish contact points. R refuses to relay the commit phase, so
		// the commit reaches O and V (directly) and R (delivered to it), but R forwards nothing onward — F,
		// whose only neighbour is R and which has no contact point, is cut off from the push. F pulls O's
		// settled record over O's contact point (no direct F—O edge, so no interior refuser in the way) and
		// settles. This is the hard case principle 3 names: on a linear chain, nothing routes around a refuser.
		const graph = makeGraph(
			['O', 'V', 'R', 'F'],
			[
				['ov', 'O', 'V'],
				['vr', 'V', 'R'],
				['rf', 'R', 'F'],
			],
		)
		const members: LiftMemberSpec[] = [
			{ name: 'O', roles: [PART], physical: true },
			{ name: 'V', roles: [PART, VOTER], physical: true },
			{ name: 'R', roles: [PART] },
			{ name: 'F', roles: [PART] },
		]
		const { net, doubles, traces } = makeNet({ graph, refuseRelay: (n) => n === 'R' })
		const tx = await runLift(net, { members, route: ['O', 'V', 'R', 'F'], payload: PAYLOAD })

		// The push settles everyone up to and including the refuser; F is stranded.
		expect(await outcomes(net, ['O', 'V', 'R', 'F'], tx)).toEqual(['commit', 'commit', 'commit', 'pending'])
		expect(doubles.get('F')!.releaseSuccesses).toEqual([]) // nothing reached F → nothing released

		// F pulls and settles — synchronously (the pull resolves on a microtask), so fetchOutcome returns commit.
		expect(await net.consensusNode('F').fetchOutcome(tx)).toBe('commit')
		await net.clock.runUntilIdle() // flush the pushes F's own settlement scheduled
		expect(await net.consensusNode('F').outcome(tx)).toBe('commit')
		expect(doubles.get('F')!.releaseSuccesses).toEqual([true]) // released exactly once, success

		// The pull itself is traced: F asked every reachable peer (both contact points plus its sole link
		// peer R) and recorded a per-peer `record-pulled` — ok:true from O and V (both already committed and
		// willing to serve), ok:false from R (the refuser serves no pulls either).
		const pulledByF = traces
			.filter((event): event is Extract<TraceEvent, { type: 'record-pulled' }> => event.type === 'record-pulled' && event.nodeId === net.memberKey('F'))
			.map((event) => [event.from, event.ok])
		expect(new Map(pulledByF)).toEqual(
			new Map([
				[net.memberKey('O'), true],
				[net.memberKey('V'), true],
				[net.memberKey('R'), false],
			]),
		)

		// A second pull after settlement is idempotent: no second release, no delivery error.
		expect(await net.consensusNode('F').fetchOutcome(tx)).toBe('commit')
		await net.clock.runUntilIdle()
		expect(doubles.get('F')!.releaseSuccesses).toEqual([true])
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})

	it('the same chain without contact points: the far member has no path to a voter and stays pending even after a pull', async () => {
		// Drop every contact point. F's only reachable peer is the refuser R, which serves no pull, so there
		// is no path to the voter at all — the linear contrast to the circular case below.
		const graph = makeGraph(
			['O', 'V', 'R', 'F'],
			[
				['ov', 'O', 'V'],
				['vr', 'V', 'R'],
				['rf', 'R', 'F'],
			],
		)
		const members: LiftMemberSpec[] = [
			{ name: 'O', roles: [PART] },
			{ name: 'V', roles: [PART, VOTER] },
			{ name: 'R', roles: [PART] },
			{ name: 'F', roles: [PART] },
		]
		const { net, doubles } = makeNet({ graph, refuseRelay: (n) => n === 'R' })
		const tx = await runLift(net, { members, route: ['O', 'V', 'R', 'F'], payload: PAYLOAD })

		expect(await outcomes(net, ['O', 'V', 'R', 'F'], tx)).toEqual(['commit', 'commit', 'commit', 'pending'])
		expect(await net.consensusNode('F').fetchOutcome(tx)).toBe('pending') // R serves no pull; no other path exists
		expect(doubles.get('F')!.releaseSuccesses).toEqual([])
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})

	it('a circular lift routes around one refuser with no contact points at all', async () => {
		// Ring A—B—C—A, A the sole voter, B refuses to relay. A pushes its commit to both neighbours directly
		// (ab and ca), so C is reached over ca without ever going through B. The whole ring commits.
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
		const { net, doubles } = makeNet({ graph, refuseRelay: (n) => n === 'B' })
		const tx = await runLift(net, { members, route: ['A', 'B', 'C', 'A'], payload: PAYLOAD })

		expect(await outcomes(net, ['A', 'B', 'C'], tx)).toEqual(['commit', 'commit', 'commit'])
		for (const name of ['A', 'B', 'C']) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([true])
		}
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})

	it('the originator goes silent after promising: the two voters still reach a majority over their contact points and commit', async () => {
		// V1—O—V2, O the [P]-only minter, V1/V2 the voters with contact points. O promises, then goes silent
		// for the commit phase. The voters exchange their commits directly (contact point to contact point),
		// reach 2 of 2, and commit; O, which receives no commit, stays pending. The lift settles without the
		// originator online post-promise.
		const graph = makeGraph(
			['V1', 'O', 'V2'],
			[
				['vo', 'V1', 'O'],
				['ov2', 'O', 'V2'],
			],
		)
		const members: LiftMemberSpec[] = [
			{ name: 'O', roles: [PART] },
			{ name: 'V1', roles: [PART, VOTER], physical: true },
			{ name: 'V2', roles: [PART, VOTER], physical: true },
		]
		const { net, doubles } = makeNet({ graph, silentAfterPromise: (n) => n === 'O' })
		const { record, transactionCode: tx } = net.buildLift({ members, route: ['V1', 'O', 'V2'], payload: PAYLOAD })
		await net.consensusNode('O').start(record) // O injects and promises, then falls silent for commits
		await net.clock.runUntilIdle()

		expect(await outcomes(net, ['V1', 'O', 'V2'], tx)).toEqual(['commit', 'pending', 'commit'])
		expect(doubles.get('V1')!.releaseSuccesses).toEqual([true])
		expect(doubles.get('V2')!.releaseSuccesses).toEqual([true])
		expect(doubles.get('O')!.releaseSuccesses).toEqual([]) // O never saw the commit → never released
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})

	it('the payee goes silent after its promise reached the originator: minting already happened, so the lift still commits', async () => {
		// O—A—Z, O the origin and sole voter, Z the payee. Z's promise reaches O via A (promise phase always
		// flows) before Z goes silent; O votes and settles, A commits, and A's commit to Z is dropped. The
		// originator holds the full plan, so Z's silence does not block settlement — O and A commit, Z pends.
		const graph = makeGraph(
			['O', 'A', 'Z'],
			[
				['oa', 'O', 'A'],
				['az', 'A', 'Z'],
			],
		)
		const members: LiftMemberSpec[] = [
			{ name: 'O', roles: [PART, VOTER] },
			{ name: 'A', roles: [PART] },
			{ name: 'Z', roles: [PART] },
		]
		const { net, doubles } = makeNet({ graph, silentAfterPromise: (n) => n === 'Z' })
		const tx = await runLift(net, { members, route: ['O', 'A', 'Z'], payload: PAYLOAD })

		expect(await outcomes(net, ['O', 'A', 'Z'], tx)).toEqual(['commit', 'commit', 'pending'])
		expect(doubles.get('O')!.releaseSuccesses).toEqual([true])
		expect(doubles.get('A')!.releaseSuccesses).toEqual([true])
		expect(doubles.get('Z')!.releaseSuccesses).toEqual([]) // Z never saw the commit → never released
		expect(net.clock.pendingTimers).toBe(0)
		expect(net.deliveryErrors).toEqual([])
	})
})

describe('consensus end to end — settling by deadline', () => {
	it('a promise phase that only completes after the code expires voids the whole route by deadline', async () => {
		// A—B carries a 400_000 ms latency; A—V (the sole voter) is instant. A promises at t=0 and reaches V at
		// once, but B's promise does not arrive until t=400_000; B then completes the promise phase and its
		// completed record returns to A at t=800_000 — past the 600_000 ms code expiry. A re-pushes the complete
		// set to V, whose completing-promise update now lands post-expiry: castCommit's expired path votes NC,
		// and as the sole voter that voids the whole route. (Each node's own deadline timer fires at ~605_000 and
		// no-ops — it held an incomplete set then — so this exercises deadline-DRIVEN settlement; onDeadline's own
		// voter-NC branch is unreachable via normal delivery and is covered only at the unit level, see
		// participant.test.ts "deadline timer" (a). Keep the ab latency 400_000 exactly: 2×=800_000 > 600_000 so
		// the completed set lands post-expiry, yet each single 400_000 hop leaves B's promise margin ≥ 30_000.)
		const graph = makeGraph(['A', 'B', 'V'], [['ab', 'A', 'B'], ['av', 'A', 'V']])
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART] },
			{ name: 'B', roles: [PART] },
			{ name: 'V', roles: [VOTER] },
		]
		const { net, doubles } = makeNet({ graph, conditions: { ab: { latencyMs: 400_000 } } })
		const tx = await runLift(net, { members, route: ['A', 'B'], extraLinks: [['A', 'V']], payload: PAYLOAD })

		expect(await outcomes(net, ['A', 'B', 'V'], tx)).toEqual(['void', 'void', 'void'])
		for (const name of ['A', 'B', 'V']) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([false]) // released once, as a void
		}
		expect(net.clock.pendingTimers).toBe(0) // one-shot deadlines fire and drain; no node re-arms past expiry
		expect(net.deliveryErrors).toEqual([])
	})
})
