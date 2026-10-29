/**
 * Two parties on one machine, each a node kept in its own folder -- what two CLI profiles are --
 * listening on loopback so no relay is needed. A tally forms between them, and a party stopped
 * and started again from its folder alone comes back as the same party holding the same tally.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CadreNode } from '@serfab/cadre-core'
import type { Result } from 'taleus-model'
import { slotDocumentCache } from 'taleus-model/contracts'
import { createEngineModel, type EngineModel } from 'taleus-model/engine'
import { offline, testContract } from 'taleus-model/testing'

import { taleusSApp } from '../sapp.js'
import { cadreStoreProvider } from '../store.js'
import { fileSlot, loopbackListenAddress, openParty, partyDirs, startPartyNode, type PartyDirs } from './index.js'

const LIFECYCLE_MS = 180_000
const CONVERGE_MS = 90_000
const SAPP = taleusSApp()
const CONTRACT = await testContract()
const USD = { denom: 'iso4217:USD', divisor: 100 }
const usd = (units: number) => ({ units, ...USD })

function must<T>(result: Result<T>): T {
	if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`)
	return result.value
}

async function waitUntil(description: string, check: () => Promise<boolean>): Promise<void> {
	const deadline = Date.now() + CONVERGE_MS
	while (Date.now() < deadline) {
		if (await check()) return
		await new Promise(resolve => setTimeout(resolve, 500))
	}
	throw new Error(`timed out waiting until ${description}`)
}

interface Party {
	dirs: PartyDirs
	node: CadreNode
	engine: EngineModel
}

/** A party's node from its folder, and the engine over it, as a CLI starts one. */
async function startParty(dirs: PartyDirs, options: { holdsContract?: boolean } = {}): Promise<Party> {
	const { config } = await openParty(dirs)
	const node = await startPartyNode({ dirs, config, sAppId: SAPP.id, listen: [await loopbackListenAddress(dirs, config)] })
	const engine = await createEngineModel({
		store: cadreStoreProvider({ node, sApp: SAPP, disclosure: { purpose: 'tally' } }),
		storage: { state: fileSlot(dirs, 'session'), identity: fileSlot(dirs, 'identity') },
		documents: options.holdsContract ? CONTRACT.cache() : slotDocumentCache(cid => fileSlot(dirs, 'document', cid)),
		fetch: options.holdsContract ? offline : CONTRACT.publisher,
		acceptOffers: !options.holdsContract,
	})
	return { dirs, node, engine }
}

async function stopParty(party: Party): Promise<void> {
	await party.engine.stop()
	await party.node.stop()
}

describe('two parties, each a node kept in its own folder', () => {
	let home: string
	const running: Party[] = []

	beforeAll(async () => {
		home = await mkdtemp(join(tmpdir(), 'taleus-host-'))
	})

	afterAll(async () => {
		for (const party of running) await stopParty(party).catch((error: unknown) => console.warn('stopping a party failed:', error))
		await rm(home, { recursive: true, force: true })
	}, LIFECYCLE_MS)

	it('form a tally, and a party restarted from its folder comes back holding it', async () => {
		const jan = await startParty(partyDirs('jan', home), { holdsContract: true })
		const samDirs = partyDirs('sam', home)
		const sam = await startParty(samDirs)
		running.push(jan, sam)

		must(await jan.engine.model.party.createIdentity())
		must(await jan.engine.model.party.setDisplayName('Jan'))
		must(await sam.engine.model.party.createIdentity())
		must(await sam.engine.model.party.setDisplayName('Sam'))
		const invitation = must(await jan.engine.model.invitations.createInvitation({
			unit: USD,
			creditLimit: usd(50000),
			noticeDays: 30,
			agreementId: CONTRACT.cid,
			goodForDays: 7,
		}))
		must(await sam.engine.model.invitations.respondToInvitation(invitation.token, 'accept', { disclose: {}, creditLimit: usd(0), noticeDays: 30 }))
		await waitUntil('the tally opens on both sides', async () => {
			const mine = await jan.engine.model.tallies.listTallies()
			const theirs = await sam.engine.model.tallies.listTallies()
			return mine.ok && theirs.ok && mine.value[0]?.state === 'Open' && theirs.value[0]?.state === 'Open'
		})
		const [{ id }] = must(await sam.engine.model.tallies.listTallies())
		const sid = must(await sam.engine.model.party.readParty())?.sid

		// Sam's machine stops; a new node and engine start over the same folder, as the next run does.
		await stopParty(sam)
		running.splice(running.indexOf(sam), 1)
		const again = await startParty(samDirs)
		running.push(again)
		expect(must(await again.engine.model.party.readParty())?.sid).toBe(sid)
		await waitUntil('the restarted party holds the tally again', async () => {
			const tallies = await again.engine.model.tallies.listTallies()
			return tallies.ok && tallies.value[0]?.id === id && tallies.value[0].state === 'Open'
		})
	}, LIFECYCLE_MS * 2)
})
