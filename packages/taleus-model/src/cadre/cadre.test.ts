/**
 * Tallies on real Sereus strands: two parties, each its own `CadreNode` over memory storage,
 * talking over loopback WebSockets -- the recipe of sereus's own cross-party integration tests
 * (`strand-chat-participants-converge`). Slow by nature: each party starts libp2p, founds or
 * joins a strand, and waits for Optimystic to replicate.
 *
 * The backstop poll is off on both sides (`pollMs: 0`). Formation needs each party's agent to
 * act on the other's commits -- the inviter names the tally only once the invitee has taken its
 * seat -- so a tally that opens here proves a replicated commit wakes `subscribe`.
 */
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { webSockets } from '@libp2p/websockets'
import { MemoryRawStorage } from '@optimystic/db-p2p'
import {
	CadreNode,
	InMemoryKeyStore,
	MemoryBootstrapPeerStore,
	MemoryEnrolledMachineStore,
	MemoryStrandNetworkStateStore,
	MemoryTrustedOwnerStore,
	type SAppConfig,
} from '@serfab/cadre-core'
import tallySchema from 'taleus-core/schema-text/draft1'

import { createEngineModel, type EngineModel, type PartyIdentity } from '../engine/index.js'
import type { Result } from '../types.js'
import { cadreStoreProvider } from './store.js'

const LIFECYCLE_MS = 120_000
const CONVERGE_MS = 60_000

/** The tally sApp, unsigned: the nodes below relax schema signing, as a development build would. */
const TALEUS_SAPP: SAppConfig = { id: 'taleus-tally', version: '1', schema: tallySchema, latencyHint: 'interactive' }

const USD = { denom: 'iso4217:USD', scale: 2 }
const usd = (units: number) => ({ units, ...USD })

function must<T>(result: Result<T>): T {
	if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`)
	return result.value
}

/** Poll `check` until it holds, failing with `description` after `timeoutMs`. */
async function waitUntil(description: string, check: () => Promise<boolean>, timeoutMs = CONVERGE_MS): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await check()) return
		await new Promise(resolve => setTimeout(resolve, 500))
	}
	throw new Error(`timed out waiting until ${description}`)
}

/**
 * Everything a party's machine keeps across a restart: its identity key, its blocks per storage
 * scope, and its node-local records. A node rebuilt over the same device is the same machine.
 */
class Device {
	readonly keyStore = new InMemoryKeyStore()
	private readonly storage = new Map<string, MemoryRawStorage>()
	readonly trustedOwners: MemoryTrustedOwnerStore
	readonly bootstrapPeers: MemoryBootstrapPeerStore
	readonly enrolledMachines: MemoryEnrolledMachineStore
	readonly strandNetworkState: MemoryStrandNetworkStateStore

	constructor(readonly partyId: string) {
		this.trustedOwners = new MemoryTrustedOwnerStore(partyId)
		this.bootstrapPeers = new MemoryBootstrapPeerStore(partyId)
		this.enrolledMachines = new MemoryEnrolledMachineStore(partyId)
		this.strandNetworkState = new MemoryStrandNetworkStateStore(partyId)
	}

	storageFor(scope: string): MemoryRawStorage {
		let storage = this.storage.get(scope)
		if (!storage) {
			storage = new MemoryRawStorage()
			this.storage.set(scope, storage)
		}
		return storage
	}

	/** Start a node on this device, enrolled as its own party's owner (as a phone is). */
	async start(bootstrapNodes: string[] = []): Promise<CadreNode> {
		const node = new CadreNode({
			controlNetwork: { partyId: this.partyId, bootstrapNodes },
			profile: 'transaction',
			strandFilter: { mode: 'all' },
			hostUnclaimedStrands: false,
			storage: { provider: scope => this.storageFor(scope) },
			keyStore: this.keyStore,
			network: { transports: [webSockets(), circuitRelayTransport()], listenAddrs: ['/ip4/127.0.0.1/tcp/0/ws'] },
			trustedOwners: { store: this.trustedOwners },
			bootstrapPeers: { store: this.bootstrapPeers },
			enrolledMachines: { store: this.enrolledMachines },
			strandNetworkState: { store: this.strandNetworkState },
			hibernation: { enabled: false },
			requireSignedSchemas: false,
		})
		await node.start()
		const { privateKeyB64, publicKeyB64 } = node.getIdentityOwnerKey()
		await node.getControlDatabase()!.ensureOwnerKey(publicKeyB64)
		await node.initializeSeedBootstrap(privateKeyB64)
		return node
	}
}

function controlAddrs(node: CadreNode): string[] {
	return node.getControlNode()!.getMultiaddrs().map(a => a.toString())
}

/** A party's engine model over the cadre store, keeping the identity it creates. */
async function engineOn(node: CadreNode, options: { acceptOffers?: boolean; identity?: PartyIdentity } = {}) {
	let identity = options.identity
	const engine = await createEngineModel({
		store: cadreStoreProvider({ node, sApp: TALEUS_SAPP, pollMs: 0, disclosure: { purpose: 'tally' } }),
		acceptOffers: options.acceptOffers,
		identity: options.identity,
		onIdentityCreated: created => {
			identity = created
		},
	})
	return { engine, identity: () => identity }
}

/** Invite, accept, and wait until the tally is open on both sides; returns its id. */
async function openTally(me: EngineModel, them: EngineModel): Promise<string> {
	must(await me.model.party.createIdentity())
	must(await me.model.party.setDisplayName('Jan'))
	must(await them.model.party.createIdentity())
	must(await them.model.party.setDisplayName('Sam'))
	const invitation = must(
		await me.model.invitations.createInvitation({
			unit: USD,
			creditLimit: usd(50000),
			noticeDays: 21,
			agreementId: 'cid:standard-tally-v1',
			goodForDays: 7,
		}),
	)
	must(await them.model.invitations.respondToInvitation(invitation.token, 'accept', {
		disclose: {},
		creditLimit: usd(20000),
		noticeDays: 21,
	}))
	await waitUntil('the tally opens on both sides', async () => {
		const mine = await me.model.tallies.listTallies()
		const theirs = await them.model.tallies.listTallies()
		return mine.ok && theirs.ok && mine.value[0]?.state === 'Open' && theirs.value[0]?.state === 'Open'
	})
	return must(await me.model.tallies.listTallies())[0].id
}

async function balanceOf(engine: EngineModel): Promise<number | undefined> {
	const tallies = await engine.model.tallies.listTallies()
	return tallies.ok ? tallies.value[0]?.balance.units : undefined
}

describe('a tally formed through the engine, on real strands', () => {
	const nodes: CadreNode[] = []
	const engines: EngineModel[] = []

	afterAll(async () => {
		for (const engine of engines) await engine.stop()
		for (const node of nodes) if (node.isRunning) await node.stop()
	}, LIFECYCLE_MS)

	it('forms, opens, carries entries both ways, and survives the invitee restarting', async () => {
		const tag = Date.now()
		const inviterDevice = new Device(`taleus-me-${tag}`)
		const inviteeDevice = new Device(`taleus-them-${tag}`)
		const inviter = await inviterDevice.start()
		let invitee = await inviteeDevice.start(controlAddrs(inviter))
		nodes.push(inviter, invitee)

		const me = (await engineOn(inviter)).engine
		const first = await engineOn(invitee, { acceptOffers: true })
		engines.push(me, first.engine)
		const tallyId = await openTally(me, first.engine)

		must(await first.engine.model.entries.recordEntry(tallyId, { actId: 'act:1', amount: usd(1800), memo: 'March hours' }))
		await waitUntil('the entry reaches the inviter', async () => (await balanceOf(me)) === 1800)
		expect(must(await me.model.tallies.listTallies())[0].balance).toEqual({ ...usd(1800), perspective: 'owed-to-me' })

		// The invitee's machine restarts: a new node over the same device, a new store and engine
		// with the same Taleus identity. The tally comes back because the node re-offers the strand.
		await first.engine.stop()
		await invitee.stop()
		invitee = await inviteeDevice.start(controlAddrs(inviter))
		nodes.push(invitee)
		const again = (await engineOn(invitee, { identity: first.identity() })).engine
		engines.push(again)
		await waitUntil('the restarted invitee holds the tally again', async () => (await balanceOf(again)) === 1800)

		must(await me.model.entries.recordEntry(tallyId, { actId: 'act:2', amount: usd(500), memo: 'Refund' }))
		await waitUntil('a new entry reaches the restarted invitee', async () => (await balanceOf(again)) === 1300)
	}, LIFECYCLE_MS * 3)
})
