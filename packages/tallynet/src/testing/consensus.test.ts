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
 *   lifetime at `clock.now()` (= 0 on a fresh clock). The "sleeping node" / "slow third referee" cases
 *   use a 50_000 ms latency so no code expires mid-run (an expired code would make the woken node refuse
 *   and void the lift — a different outcome from the one under test).
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { base64urlToBytes, bytesToBase64url } from '../base64url.js'
import type { Signer, Verifier } from '../crypto.js'
import { generate } from '../session-code.js'
import type { TraceEvent } from '../trace.js'
import { signRecord } from '../consensus/signature.js'
import type { ResourceContext, TrxParticipantResource } from '../consensus/resource.js'
import type { Signature, TrxRecord } from '../consensus/types.js'
import { MemberTypes, type MemberType } from '../discovery/types.js'
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
const REF: MemberType = MemberTypes.referee
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

/* ── resource doubles (one per node; the test reads back what each held/released) ────────────────── */

interface ResourceOpts {
	/** `shouldPromise` gate value. Omitted → the hook is absent (engine defaults true → promises). */
	shouldPromise?: boolean
	/** `shouldCommit` gate value for a referee. Omitted → the hook is absent (engine defaults true → C). */
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

/** A linear chain of `n` participants `P0..P{n-1}`; the last is also the sole referee. */
function linear(n: number): { names: string[]; graph: NetworkGraph<Terms>; members: LiftMemberSpec[] } {
	const names = Array.from({ length: n }, (_, i) => `P${i}`)
	const edges: Array<[string, string, string]> = names.slice(1).map((name, i) => [`e${i}`, names[i], name])
	const graph = makeGraph(names, edges)
	const members: LiftMemberSpec[] = names.map((name, i) => ({ name, roles: i === n - 1 ? [PART, REF] : [PART] }))
	return { names, graph, members }
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
		const { names, graph, members } = linear(3) // P0 (origin) — P1 (refuser) — P2 ([P,R])
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

	it('a referee that votes no-commit voids everywhere', async () => {
		const graph = makeGraph(['A', 'B', 'R'], [['ab', 'A', 'B']])
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART], physical: true },
			{ name: 'B', roles: [PART], physical: true },
			{ name: 'R', roles: [REF], physical: true },
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
	it('a ring A→B→C→A (A the sole referee) commits and releases once at every node', async () => {
		const graph = makeGraph(
			['A', 'B', 'C'],
			[
				['ab', 'A', 'B'],
				['bc', 'B', 'C'],
				['ca', 'C', 'A'],
			],
		)
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART, REF] },
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
		// A—B—D and A—C—D; the A—B edge is dropped. The record reaches referee D over the A→C→D arm; D's
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
			{ name: 'D', roles: [PART, REF] },
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
			{ name: 'T', roles: [PART, REF] },
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
			{ name: 'C', roles: [PART, REF] },
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

describe('consensus end to end — referee set sizes', () => {
	/** Two participants plus `refs` referee-only members, all with a physical address for complete reachability. */
	function refereeSet(refs: string[], specs: Record<string, ResourceOpts> = {}, conditions?: Record<string, LinkCondition>) {
		const nodes = ['A', 'B', ...refs]
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART], physical: true },
			{ name: 'B', roles: [PART], physical: true },
			...refs.map((name) => ({ name, roles: [REF], physical: true })),
		]
		return { nodes, members, graph: makeGraph(nodes, [['ab', 'A', 'B']]), specs, conditions }
	}

	it('a set of one commits the route', async () => {
		const { nodes, members, graph } = refereeSet(['R'])
		const { net, doubles } = makeNet({ graph })
		const tx = await runLift(net, { members, route: ['A', 'B'], payload: PAYLOAD })
		expect(await outcomes(net, nodes, tx)).toEqual(nodes.map(() => 'commit'))
		for (const name of nodes) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([true])
		}
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('a set of two that both commit reaches a strict majority and commits', async () => {
		const { nodes, members, graph } = refereeSet(['R1', 'R2'])
		const { net, doubles } = makeNet({ graph })
		const tx = await runLift(net, { members, route: ['A', 'B'], payload: PAYLOAD })
		expect(await outcomes(net, nodes, tx)).toEqual(nodes.map(() => 'commit'))
		for (const name of nodes) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([true])
		}
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('a set of two that splits one commit / one void settles neither way (stall)', async () => {
		const { nodes, members, graph } = refereeSet(['R1', 'R2'], { R2: { shouldCommit: false } })
		const { net, doubles } = makeNet({ graph, resourceSpecs: { R2: { shouldCommit: false } } })
		const tx = await runLift(net, { members, route: ['A', 'B'], payload: PAYLOAD })
		expect(await outcomes(net, nodes, tx)).toEqual(nodes.map(() => 'pending')) // even split → no strict majority
		for (const name of nodes) {
			expect(doubles.get(name)!.releaseSuccesses).toEqual([]) // nothing settled in-band
		}
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('a set of three commits on the two fast votes while the third referee is still asleep, then that one commits too', async () => {
		// R3 is reached only over a slow link from B; R1 + R2 (fast, physical) are a strict majority on their own.
		const nodes = ['A', 'B', 'R1', 'R2', 'R3']
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART], physical: true },
			{ name: 'B', roles: [PART], physical: true },
			{ name: 'R1', roles: [REF], physical: true },
			{ name: 'R2', roles: [REF], physical: true },
			{ name: 'R3', roles: [REF] }, // NOT physical — reached only over the slow B—R3 edge
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
	it('a post-commit equivocating referee is refused; the settled commit stands and no one re-releases', async () => {
		const seed = 'equivocate'
		const graph = makeGraph(['A', 'B', 'R'], [['ab', 'A', 'B']])
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART], physical: true },
			{ name: 'B', roles: [PART], physical: true },
			{ name: 'R', roles: [REF], physical: true },
		]
		const { net, doubles, traces } = makeNet({ graph, seed })
		const tx = await runLift(net, { members, route: ['A', 'B'], payload: PAYLOAD })
		expect(await net.consensusNode('A').outcome(tx)).toBe('commit')

		// The referee now signs the opposite face (NC) over the same, complete promise set and we deliver it.
		const settled = await net.consensusStoreOf('A').getRecord(tx)
		const refVoid = await signRecord(makeSigner(seed, 'R'), 'NC', settled!)
		await net.consensusNode('A').update({ ...settled!, commits: [refVoid] })
		await net.clock.runUntilIdle()

		expect(rejectReasons(traces)).toContain('equivocation') // the second face is refused; the first stands
		expect(await net.consensusNode('A').outcome(tx)).toBe('commit')
		expect(doubles.get('A')!.releaseSuccesses).toEqual([true]) // still exactly one release
		expect(net.clock.pendingTimers).toBe(0)
	})

	it('a forged referee commit is dropped; the genuine majority still reads as a commit', async () => {
		// An observer X (not a member, so it only merges and classifies) is handed a complete-promise record
		// carrying two genuine referee commits and one forged one. The forged commit fails verification once the
		// promise phase is complete and is dropped; two of three genuine votes are a strict majority → commit.
		const seed = 'forge'
		const graph = makeGraph(['A', 'B', 'R1', 'R2', 'R3', 'X'], [['ab', 'A', 'B']])
		const members: LiftMemberSpec[] = [
			{ name: 'A', roles: [PART] },
			{ name: 'B', roles: [PART] },
			{ name: 'R1', roles: [REF] },
			{ name: 'R2', roles: [REF] },
			{ name: 'R3', roles: [REF] },
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
		expect(await net.consensusNode('X').outcome(tx)).toBe('commit') // 2 of 3 genuine referees
		expect(doubles.get('X')!.releaseSuccesses).toEqual([]) // X is a relay — it classifies but never acts
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
