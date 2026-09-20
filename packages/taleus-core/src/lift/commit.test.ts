import { LiftJournalOriginatorState } from './agent.js'
import {
	applyResolution,
	LiftCommit,
	LiftParticipant,
	pledgeEdge,
	rebuildEdgePhase,
	type LiftRecord,
	type OwnedEdge,
	type RecordEdge,
} from './commit.js'
import {
	InMemoryLiftJournalStore,
	InMemoryTally,
	ScriptedConsensusEngine,
	identity,
	referee,
} from './test-harness.js'
import type { LiftPlan } from './terms.js'

const DATE = '2026-07-13'
const EXPIRY = '2026-07-20'
const BIG = 1_000_000_000n

/** A monotonic string clock for deterministic journal `Updated` timestamps. */
function clock(): () => string {
	let t = 0
	return () => `t${t++}`
}

interface EdgeSpec {
	liftId: string
	cid: string
	issuer: 'S' | 'F'
	units: bigint
	stockLimit?: bigint
	foilLimit?: bigint
}

/** Build a route: one `InMemoryTally` per edge, the owned edges, the ChipNet record, and the referee cid map. */
function buildRoute(refKey: string, specs: EdgeSpec[], signer = identity().signer) {
	const cids = new Map<string, string>()
	const strands = new Map<string, InMemoryTally>()
	const owned: OwnedEdge[] = []
	const recordEdges: RecordEdge[] = []
	for (const s of specs) {
		const tally = new InMemoryTally(s.cid, s.stockLimit ?? BIG, s.foilLimit ?? BIG)
		cids.set(s.liftId, s.cid)
		strands.set(s.liftId, tally)
		owned.push({ liftId: s.liftId, strand: tally, issuer: s.issuer, units: s.units, date: DATE, expiry: EXPIRY })
		recordEdges.push({ liftId: s.liftId, nonce: `n-${s.liftId}`, issuer: s.issuer, units: s.units.toString(), date: DATE, expiry: EXPIRY })
	}
	const record: LiftRecord = { sessionCode: 's1', transactionCode: 'tx1', refereeKey: refKey, edges: recordEdges }
	return { cids, strands, owned, record, signer }
}

/** Minimal `LiftPlan` for the driver (it reads only `liftId` + `edges`). */
function makePlan(liftId: string, edges: Array<{ nonce: string; denom: string; units: bigint }>): LiftPlan {
	return {
		liftId,
		sessionCode: 's1',
		kind: 'circular',
		edges: edges.map((e) => ({ nonce: e.nonce, denom: e.denom, scale: 0, units: e.units })),
		referee: { key: 'ref' },
		source: { denom: 'CHIP', scale: 0, units: 0n, feeRatioPpm: 0 },
	}
}

/** Flip one hex character so a signature no longer verifies. */
function tamper(hex: string): string {
	return hex.slice(0, -1) + (hex.slice(-1) === 'f' ? 'e' : 'f')
}

const noop = (): void => {}

async function pledgeAll(owned: OwnedEdge[], refKey: string, signer: Parameters<typeof pledgeEdge>[2]): Promise<void> {
	for (const e of owned) {
		await pledgeEdge(e, refKey, signer)
	}
}

describe('full-route commit', () => {
	it('settles every edge; settled balance moves by the ceiled units per edge (both signs)', async () => {
		const { ref, key } = referee()
		const { cids, strands, owned, record, signer } = buildRoute(key, [
			{ liftId: 'L1', cid: 'cid-1', issuer: 'F', units: 300n }, // receiver: +300
			{ liftId: 'L2', cid: 'cid-2', issuer: 'S', units: 1500n }, // releaser: −1500
		])
		await pledgeAll(owned, key, signer)
		// Open pledges reserve capacity (settled still 0).
		expect(strands.get('L1')!.reservedBalance()).toBe(300n)
		expect(strands.get('L1')!.settledBalance()).toBe(0n)

		const resolved = await new ScriptedConsensusEngine(ref, cids, 'commit').resolve(record)
		const result = await applyResolution(resolved, owned, new Map(), noop)

		expect(result.decision).toBe('commit')
		expect(result.edges.map((e) => e.applied)).toEqual(['finalized', 'finalized'])
		expect(strands.get('L1')!.settledBalance()).toBe(300n)
		expect(strands.get('L2')!.settledBalance()).toBe(-1500n)
		// Finalize moves reserved→settled with no double-count: reserved == settled once the pledge closes.
		expect(strands.get('L1')!.reservedBalance()).toBe(300n)
		expect(strands.get('L1')!.finalizedLedger).toEqual([{ liftId: 'L1', delta: 300n, balance: 300n }])
	})
})

describe('full-route void', () => {
	it('releases every edge with zero settled movement', async () => {
		const { ref, key } = referee()
		const { cids, strands, owned, record, signer } = buildRoute(key, [
			{ liftId: 'L1', cid: 'cid-1', issuer: 'F', units: 300n },
			{ liftId: 'L2', cid: 'cid-2', issuer: 'F', units: 1500n },
		])
		await pledgeAll(owned, key, signer)

		const resolved = await new ScriptedConsensusEngine(ref, cids, 'void').resolve(record)
		const result = await applyResolution(resolved, owned, new Map(), noop)

		expect(result.edges.map((e) => e.applied)).toEqual(['voided', 'voided'])
		for (const liftId of ['L1', 'L2']) {
			expect(strands.get(liftId)!.settledBalance()).toBe(0n)
			expect(strands.get(liftId)!.reservedBalance()).toBe(0n) // reservation released
			expect(strands.get(liftId)!.finalizedLedger).toHaveLength(0)
		}
	})
})

describe('mutual exclusion & replay', () => {
	it('rejects a second finalize (idempotent skip on re-ingest; strand rejects a direct double-finalize)', async () => {
		const { ref, key } = referee()
		const { cids, strands, owned, record, signer } = buildRoute(key, [{ liftId: 'L1', cid: 'cid-1', issuer: 'F', units: 300n }])
		await pledgeAll(owned, key, signer)
		const resolved = await new ScriptedConsensusEngine(ref, cids, 'commit').resolve(record)

		await applyResolution(resolved, owned, new Map(), noop)
		// Re-ingest with a fresh seen-map: strand.status reports finalized → idempotent no-op, no double delta.
		const again = await applyResolution(resolved, owned, new Map(), noop)
		expect(again.edges[0].applied).toBe('skipped-idempotent')
		expect(strands.get('L1')!.finalizedLedger).toHaveLength(1)
		// A direct second finalize on the strand is rejected outright.
		await expect(strands.get('L1')!.finalize('L1', resolved.edgeSignatures!.L1)).rejects.toThrow(/single-finalize/)
	})

	it('a commit signature cannot be replayed as a void', async () => {
		const { ref, key } = referee()
		const { cids, strands, owned, record, signer } = buildRoute(key, [{ liftId: 'L1', cid: 'cid-1', issuer: 'F', units: 300n }])
		await pledgeAll(owned, key, signer)
		const commitResolved = await new ScriptedConsensusEngine(ref, cids, 'commit').resolve(record)
		// The commit signature over the terms digest cannot satisfy the DISTINCT void digest.
		await expect(strands.get('L1')!.void('L1', commitResolved.edgeSignatures!.L1)).rejects.toThrow(/RefereeVoidValid/)
	})

	it('a finalize after a void is rejected (whole route stays voided)', async () => {
		const { ref, key } = referee()
		const { cids, strands, owned, record, signer } = buildRoute(key, [{ liftId: 'L1', cid: 'cid-1', issuer: 'F', units: 300n }])
		await pledgeAll(owned, key, signer)
		const voidResolved = await new ScriptedConsensusEngine(ref, cids, 'void').resolve(record)
		await applyResolution(voidResolved, owned, new Map(), noop)
		const commitResolved = await new ScriptedConsensusEngine(ref, cids, 'commit').resolve(record)
		await expect(strands.get('L1')!.finalize('L1', commitResolved.edgeSignatures!.L1)).rejects.toThrow(/NotVoided/)
	})
})

describe('reserved-credit gate', () => {
	it('two concurrent pledges on one edge respect the reserved gate', async () => {
		const { key } = referee()
		const signer = identity().signer
		const tally = new InMemoryTally('cid-x', 500n, 500n)
		const e1: OwnedEdge = { liftId: 'La', strand: tally, issuer: 'F', units: 300n, date: DATE, expiry: EXPIRY }
		const e2: OwnedEdge = { liftId: 'Lb', strand: tally, issuer: 'F', units: 300n, date: DATE, expiry: EXPIRY }

		await pledgeEdge(e1, key, signer) // reserved 300 ≤ 500 ✓
		await expect(pledgeEdge(e2, key, signer)).rejects.toThrow(/WithinReservedCredit/) // 600 > 500 ✗
		expect(tally.reservedBalance()).toBe(300n) // the rejected pledge did not land
	})
})

describe('originator driver', () => {
	it('pledges → commits → settles, journaling pending → committed', async () => {
		const { ref, key } = referee()
		const id = identity()
		const { cids, strands, owned, record } = buildRoute(key, [{ liftId: 'L1', cid: 'cid-1', issuer: 'F', units: 300n }], id.signer)
		const store = new InMemoryLiftJournalStore()
		const state = new LiftJournalOriginatorState(store, clock())
		const driver = new LiftCommit({ engine: new ScriptedConsensusEngine(ref, cids, 'commit'), state, signer: id.signer })

		const plan = makePlan('WL1', [{ nonce: 'n-L1', denom: 'CHIP', units: 300n }])
		const outcome = await driver.commit(plan, record, owned)

		expect(outcome.committed).toBe(true)
		expect(strands.get('L1')!.settledBalance()).toBe(300n)
		expect(store.rows.map((r) => r.state)).toEqual(['pending', 'committed'])
	})

	it('a not-fully-promised route pre-promise-voids without stranding a pledge', async () => {
		const { ref, key } = referee()
		const id = identity()
		const { cids, strands, owned, record } = buildRoute(key, [{ liftId: 'L1', cid: 'cid-1', issuer: 'F', units: 300n }], id.signer)
		const store = new InMemoryLiftJournalStore()
		const state = new LiftJournalOriginatorState(store, clock())
		// The consensus returns a void (models a route that failed to fully promise).
		const driver = new LiftCommit({ engine: new ScriptedConsensusEngine(ref, cids, 'void'), state, signer: id.signer })

		const plan = makePlan('WL1', [{ nonce: 'n-L1', denom: 'CHIP', units: 300n }])
		const outcome = await driver.commit(plan, record, owned)

		expect(outcome.committed).toBe(false)
		expect(outcome.committed === false && outcome.reason).toBe('voided')
		// The pledge was written then RELEASED — no stranded reservation, no settled movement.
		expect(strands.get('L1')!.settledBalance()).toBe(0n)
		expect(strands.get('L1')!.reservedBalance()).toBe(0n)
		expect(store.rows.map((r) => r.state)).toEqual(['pending', 'aborted'])
	})

	it('routes a timeout void to the timedout journal state', async () => {
		const { ref, key } = referee()
		const id = identity()
		const { cids, owned, record } = buildRoute(key, [{ liftId: 'L1', cid: 'cid-1', issuer: 'F', units: 300n }], id.signer)
		const store = new InMemoryLiftJournalStore()
		const state = new LiftJournalOriginatorState(store, clock())
		const driver = new LiftCommit({
			engine: new ScriptedConsensusEngine(ref, cids, 'void'),
			state,
			signer: id.signer,
			timedOut: () => true,
		})
		const plan = makePlan('WL1', [{ nonce: 'n-L1', denom: 'CHIP', units: 300n }])
		const outcome = await driver.commit(plan, record, owned)
		expect(outcome.committed === false && outcome.reason).toBe('timedout')
		expect(store.rows.map((r) => r.state)).toEqual(['pending', 'timedout'])
	})
})

describe('inbound participant', () => {
	it('settles owned edges and is idempotent across a re-delivered record', async () => {
		const { ref, key } = referee()
		const { cids, strands, owned, record, signer } = buildRoute(key, [
			{ liftId: 'L1', cid: 'cid-1', issuer: 'F', units: 300n },
			{ liftId: 'L2', cid: 'cid-2', issuer: 'F', units: 1500n },
		])
		await pledgeAll(owned, key, signer)
		const participant = new LiftParticipant()
		owned.forEach((e) => participant.register(e))

		const resolved = await new ScriptedConsensusEngine(ref, cids, 'commit').resolve(record)
		const first = await participant.ingest(resolved)
		expect(first.edges.map((e) => e.applied)).toEqual(['finalized', 'finalized'])

		const second = await participant.ingest(resolved) // push-wake retry re-delivers the same record
		expect(second.edges.every((e) => e.applied === 'skipped-idempotent')).toBe(true)
		expect(strands.get('L1')!.finalizedLedger).toHaveLength(1) // applied exactly once
	})

	it('ignores a record that names no owned edge (relayed past us)', async () => {
		const { ref, key } = referee()
		const { cids, record } = buildRoute(key, [{ liftId: 'L1', cid: 'cid-1', issuer: 'F', units: 300n }])
		const participant = new LiftParticipant() // registers nothing
		const resolved = await new ScriptedConsensusEngine(ref, cids, 'commit').resolve(record)
		const result = await participant.ingest(resolved)
		expect(result.edges).toHaveLength(0)
	})
})

describe('safety: verify before acting', () => {
	it('never finalizes on an unverifiable referee signature', async () => {
		const { ref, key } = referee()
		const { cids, strands, owned, record, signer } = buildRoute(key, [{ liftId: 'L1', cid: 'cid-1', issuer: 'F', units: 300n }])
		await pledgeAll(owned, key, signer)
		const resolved = await new ScriptedConsensusEngine(ref, cids, 'commit').resolve(record)
		const tampered: LiftRecord = { ...resolved, edgeSignatures: { L1: tamper(resolved.edgeSignatures!.L1) } }

		const logs: string[] = []
		const result = await applyResolution(tampered, owned, new Map(), (m) => logs.push(m))
		expect(result.edges[0].applied).toBe('skipped-unverified')
		expect(strands.get('L1')!.settledBalance()).toBe(0n) // never settled
		expect(logs.some((m) => m.includes('unverifiable'))).toBe(true)
	})

	it('does NOT blame the referee for a forged contradicting record (verify precedes equivocation check)', async () => {
		const { ref, key } = referee()
		const { cids, strands, owned, record, signer } = buildRoute(key, [{ liftId: 'L1', cid: 'cid-1', issuer: 'F', units: 300n }])
		await pledgeAll(owned, key, signer)
		const seen = new Map<string, 'commit' | 'void'>()
		const logs: string[] = []
		const log = (m: string): number => logs.push(m)

		const commitResolved = await new ScriptedConsensusEngine(ref, cids, 'commit').resolve(record)
		await applyResolution(commitResolved, owned, seen, log)
		// A void record with a TAMPERED signature (a forgery / corruption, not the real referee).
		const voidResolved = await new ScriptedConsensusEngine(ref, cids, 'void').resolve(record)
		const forged: LiftRecord = { ...voidResolved, edgeSignatures: { L1: tamper(voidResolved.edgeSignatures!.L1) } }
		const result = await applyResolution(forged, owned, seen, log)

		// It must be rejected as unverifiable — NOT recorded as referee equivocation.
		expect(result.edges[0].applied).toBe('skipped-unverified')
		expect(logs.some((m) => m.includes('CONTRADICTION'))).toBe(false)
		expect(strands.get('L1')!.settledBalance()).toBe(300n) // commit stands, void ignored
	})

	it('detects and logs a referee that contradicts itself (commit then void for one LiftId)', async () => {
		const { ref, key } = referee()
		const { cids, owned, record, signer } = buildRoute(key, [{ liftId: 'L1', cid: 'cid-1', issuer: 'F', units: 300n }])
		await pledgeAll(owned, key, signer)
		const seen = new Map<string, 'commit' | 'void'>()
		const logs: string[] = []
		const log = (m: string): number => logs.push(m)

		const commitResolved = await new ScriptedConsensusEngine(ref, cids, 'commit').resolve(record)
		await applyResolution(commitResolved, owned, seen, log)
		const voidResolved = await new ScriptedConsensusEngine(ref, cids, 'void').resolve(record)
		const result = await applyResolution(voidResolved, owned, seen, log)

		expect(result.edges[0].applied).toBe('skipped-contradiction')
		expect(logs.some((m) => m.includes('CONTRADICTION'))).toBe(true)
	})
})

describe('crash/restart rebuild', () => {
	it('reads the authoritative phase from the strand, not the journal', async () => {
		const { ref, key } = referee()
		const { cids, owned, record, signer } = buildRoute(key, [{ liftId: 'L1', cid: 'cid-1', issuer: 'F', units: 300n }])
		expect(await rebuildEdgePhase(owned[0])).toBe('unpledged')
		await pledgeAll(owned, key, signer)
		expect(await rebuildEdgePhase(owned[0])).toBe('pending')
		const resolved = await new ScriptedConsensusEngine(ref, cids, 'commit').resolve(record)
		await applyResolution(resolved, owned, new Map(), noop)
		expect(await rebuildEdgePhase(owned[0])).toBe('finalized')
	})
})
