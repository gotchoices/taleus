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
import { generateKeyPair } from '@libp2p/crypto/keys'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { webSockets } from '@libp2p/websockets'
import { MemoryRawStorage } from '@optimystic/db-p2p'
import { CadreNode, ed25519KeyPairFromLibp2p, type SAppConfig } from '@serfab/cadre-core'
import tallySchema from 'taleus-core/schema-text/draft1'

import { createEngineModel, type EngineModel } from '../engine/index.js'
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

/** One party's cadre node, started and enrolled as its own party's owner. */
async function startParty(partyId: string, bootstrapNodes: string[] = []): Promise<CadreNode> {
	const key = await generateKeyPair('Ed25519')
	const node = new CadreNode({
		controlNetwork: { partyId, bootstrapNodes },
		profile: 'transaction',
		strandFilter: { mode: 'all' },
		hostUnclaimedStrands: false,
		storage: { provider: () => new MemoryRawStorage() },
		privateKey: key,
		network: { transports: [webSockets(), circuitRelayTransport()], listenAddrs: ['/ip4/127.0.0.1/tcp/0/ws'] },
		hibernation: { enabled: false },
		requireSignedSchemas: false,
	})
	await node.start()
	const { privateKeyB64, publicKeyB64 } = ed25519KeyPairFromLibp2p(key)
	await node.getControlDatabase()!.ensureOwnerKey(publicKeyB64)
	await node.initializeSeedBootstrap(privateKeyB64)
	return node
}

function controlAddrs(node: CadreNode): string[] {
	return node.getControlNode()!.getMultiaddrs().map(a => a.toString())
}

describe('a tally formed through the engine, on real strands', () => {
	let nodes: CadreNode[] = []
	let me: EngineModel
	let them: EngineModel

	beforeAll(async () => {
		const tag = Date.now()
		const inviter = await startParty(`taleus-me-${tag}`)
		const invitee = await startParty(`taleus-them-${tag}`, controlAddrs(inviter))
		nodes = [inviter, invitee]
		me = await createEngineModel({ store: cadreStoreProvider({ node: inviter, sApp: TALEUS_SAPP, pollMs: 0 }) })
		them = await createEngineModel({
			store: cadreStoreProvider({ node: invitee, sApp: TALEUS_SAPP, pollMs: 0, disclosure: { purpose: 'tally' } }),
			acceptOffers: true,
		})
	}, LIFECYCLE_MS)

	afterAll(async () => {
		await me?.stop()
		await them?.stop()
		for (const node of nodes) await node.stop()
	}, LIFECYCLE_MS)

	it('forms, opens, and carries an entry from one party to the other', async () => {
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

		const [tally] = must(await me.model.tallies.listTallies())
		must(await them.model.entries.recordEntry(tally.id, { actId: 'act:1', amount: usd(1800), memo: 'March hours' }))
		await waitUntil('the entry reaches the inviter', async () => {
			const mine = await me.model.tallies.listTallies()
			return mine.ok && mine.value[0]?.balance.units === 1800
		})
		expect(must(await me.model.tallies.listTallies())[0].balance).toEqual({ ...usd(1800), perspective: 'owed-to-me' })
	}, LIFECYCLE_MS * 2)
})
