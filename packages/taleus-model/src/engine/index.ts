/**
 * The engine model: every namespace answered by taleus-core.
 *
 * `createEngineModel` gives one party's model over any core store. `createLocalWorld` is the
 * one-device arrangement: this party plus a simulated counterparty, both on one in-memory fabric
 * -- real schema, real signatures, real refusals, and no network.
 */
import { MemoryFabric } from 'taleus-core'
import tallySchema from 'taleus-core/schema-text/draft1'

import type { TaleusModel } from '../model.js'
import type { AgreementDocument } from '../tally.js'
import { invitationsModel, partyModel } from './formation.js'
import { attentionModel, positionModel } from './derived.js'
import { entriesModel, requestsModel } from './ledger.js'
import { localAreas } from './local.js'
import { Session, type PartyIdentity, type SessionOptions } from './session.js'
import { offersModel, talliesModel, tallyModel } from './tallies.js'

export type { PartyIdentity, SessionOptions } from './session.js'

/** The agreement every Taleus app can offer until it is given others. */
export const STANDARD_AGREEMENT: AgreementDocument = {
	id: 'cid:standard-tally-v1',
	title: 'Standard tally',
	publisher: 'Taleus',
	language: 'en',
	version: '1',
	parameters: ['credit limit', 'notice days'],
	sections: [
		{
			heading: 'What this tally is',
			body: 'A running record of value between two parties, each extending the other the credit they choose.',
		},
		{
			heading: 'Credit',
			body: 'Each party sets the most the other may owe it, and gives the notice it states before lowering that limit.',
		},
		{
			heading: 'Closing',
			body: 'Either party may ask to close. Nothing new may then be owed; the tally closes when the balance is settled.',
		},
	],
}

export interface EngineModel {
	model: TaleusModel
	/** Resolves when this party's agent has nothing left in hand. Tests and simulations wait on it. */
	settled(): Promise<void>
	stop(): Promise<void>
	/** Agent runs so far. */
	runs(): number
}

export async function createEngineModel(options: SessionOptions): Promise<EngineModel> {
	const session = new Session({ ...options, agreements: options.agreements ?? [STANDARD_AGREEMENT] })
	if (options.identity) await session.start(options.identity)
	const local = localAreas(session)
	const model: TaleusModel = {
		party: partyModel(session),
		invitations: invitationsModel(session),
		offers: offersModel(session),
		tallies: talliesModel(session),
		tally: tallyModel(session),
		entries: entriesModel(session),
		requests: requestsModel(session),
		attention: attentionModel(session),
		position: positionModel(session, () => local.displayUnit()),
		settings: local.settings,
		notifications: local.notifications,
		rates: local.rates,
		devices: local.devices,
		profile: local.profile,
		standing: local.standing,
	}
	return {
		model,
		settled: () => session.settled(),
		stop: () => session.stop(),
		runs: () => session.runs,
	}
}

export interface LocalWorldOptions {
	/** The tally schema's text. Defaults to the core's `draft1`. */
	schema?: string
	now?: () => Date
	agreements?: AgreementDocument[]
	/** This party's identity, if it already has one. */
	identity?: PartyIdentity
	counterpartyName?: string
	/**
	 * The counterparty takes up every invitation this party makes, as soon as it is made,
	 * extending the same credit it was offered. For an app on one device, where nobody else
	 * could; a test that takes them up itself leaves it off.
	 */
	takeUpInvitations?: boolean
}

export interface LocalWorld {
	/** This party: what the screens see. */
	me: EngineModel
	/** Someone to trade with: a second, scripted party on the same fabric. Never a screen's. */
	counterparty: EngineModel
	/** Wait until both parties' agents have gone quiet -- an act by one wakes the other. */
	settled(): Promise<void>
}

export async function createLocalWorld(options: LocalWorldOptions): Promise<LocalWorld> {
	const fabric = new MemoryFabric(options.schema ?? tallySchema)
	const common = { now: options.now, agreements: options.agreements }
	const me = await createEngineModel({ ...common, store: fabric.provider('me'), identity: options.identity })
	const counterparty = await createEngineModel({ ...common, store: fabric.provider('counterparty'), acceptOffers: true })
	await counterparty.model.party.createIdentity()
	await counterparty.model.party.setDisplayName(options.counterpartyName ?? 'Sam (simulated)')
	if (options.takeUpInvitations) takeUpInvitations(me.model, counterparty.model)

	async function settled(): Promise<void> {
		// Each party's act can wake the other, so wait until a full round passes with no new runs.
		for (let round = 0; round < 50; round++) {
			const before = me.runs() + counterparty.runs()
			await me.settled()
			await counterparty.settled()
			if (me.runs() + counterparty.runs() === before) return
		}
		throw new Error('the two parties never went quiet')
	}

	return { me, counterparty, settled }
}

/** Have `them` take up every invitation `me` makes, on the terms it offers. */
function takeUpInvitations(me: TaleusModel, them: TaleusModel): void {
	const invitations = me.invitations
	const createInvitation = invitations.createInvitation.bind(invitations)
	invitations.createInvitation = async draft => {
		const made = await createInvitation(draft)
		if (made.ok) {
			const response = { disclose: {}, creditLimit: draft.creditLimit, noticeDays: draft.noticeDays }
			void them.invitations.respondToInvitation(made.value.token, 'accept', response).then(taken => {
				if (!taken.ok) console.warn('simulated counterparty could not take up an invitation:', taken.error.message)
			})
		}
		return made
	}
}
