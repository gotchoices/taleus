/**
 * One party's engine session: its identity, its device-local state, the taleus-core engine, and
 * the agent that carries out the protocol steps nobody has a screen for.
 */
import {
	createPartyIdentity,
	openTaleus,
	type LocalSigner,
	type StoreProvider,
	type Taleus,
	type Tally,
	type TallyView,
} from 'taleus-core'

import type { Amount, Unit } from '../types.js'
import { notifyWorldChanged } from '../world.js'
import type { AgreementDocument } from '../tally.js'
import type { Envelope } from './envelope.js'

export interface PartyIdentity {
	sid: string
	signer: LocalSigner
}

/** An invitation this party made, kept on this device until it is taken up or lapses. */
export interface MadeInvitation {
	token: string
	tallyId: string
	envelope: Envelope
	created: string
	note?: string
	withdrawn?: boolean
}

/** Terms this party means to publish on a tally once it exists to publish them on. */
export interface IntendedTerms {
	creditLimit: Amount
	noticeDays: number
	/** The inviter proposes the contract; the invitee reviews it. */
	propose?: { agreementId: string }
}

/**
 * Everything this device keeps that is not on any tally. In memory for now; the host will
 * persist it (and the identity's secret, in its platform's key store) when engine mode ships.
 */
export interface LocalState {
	displayName: string
	disclosed: Record<string, string>
	madeInvitations: MadeInvitation[]
	answeredInvitations: Record<string, 'accepted' | 'refused'>
	intended: Record<string, IntendedTerms>
	/**
	 * The unit each forming tally is meant to be in. The core learns a tally's denomination from
	 * its contract, so until one is proposed it reports the default (`CHIP`); the invitation said
	 * what was intended, and screens should show that.
	 */
	units: Record<string, Unit>
	setAside: Record<string, string>
}

export interface SessionOptions {
	store: StoreProvider
	/** An identity this party already has. Absent means first run: none until `createIdentity`. */
	identity?: PartyIdentity
	/** Called when a new identity is made, so the host can keep its secret. */
	onIdentityCreated?: (identity: PartyIdentity) => void
	/** The clock. Injectable so a test can say what day it is. */
	now?: () => Date
	/** Agreements this app can offer, by content address. */
	agreements?: AgreementDocument[]
	/**
	 * Accept any contract offer waiting on this party without asking. Never for a person: it is
	 * the simulated counterparty's policy, so one device has someone who says yes.
	 */
	acceptOffers?: boolean
}

export class Session {
	readonly local: LocalState = {
		displayName: '',
		disclosed: {},
		madeInvitations: [],
		answeredInvitations: {},
		intended: {},
		units: {},
		setAside: {},
	}
	identity: PartyIdentity | undefined
	engine: Taleus | undefined
	private readonly tallies = new Map<string, Tally>()
	private agentRun: Promise<void> = Promise.resolve()
	/** How many agent runs have been asked for -- lets a test tell "quiet" from "between steps". */
	runs = 0
	private unwatch: (() => void) | undefined

	constructor(readonly options: SessionOptions) {}

	now(): Date {
		return this.options.now?.() ?? new Date()
	}

	today(): string {
		return this.now().toISOString().slice(0, 10)
	}

	/** Bring up the engine for an identity. Called at start (if one exists) and on creation. */
	async start(identity: PartyIdentity): Promise<void> {
		this.identity = identity
		this.engine = await openTaleus({
			store: this.options.store,
			signer: identity.signer,
			sid: identity.sid,
			now: () => this.today(),
		})
		// Anything any tally does -- this party's acts or, on a replicated store, the other
		// party's -- may leave a protocol step for the agent, and leaves every screen stale.
		this.unwatch = this.engine.watch(() => {
			void this.advance()
			notifyWorldChanged()
		})
	}

	async createIdentity(): Promise<PartyIdentity> {
		const identity = createPartyIdentity()
		this.options.onIdentityCreated?.(identity)
		await this.start(identity)
		return identity
	}

	async stop(): Promise<void> {
		this.unwatch?.()
		await this.engine?.close()
	}

	/** The certificate this party shows a counterparty: its name and what it chose to disclose. */
	certificate(): Record<string, string> {
		return { ...(this.local.displayName ? { name: this.local.displayName } : {}), ...this.local.disclosed }
	}

	async tally(id: string): Promise<Tally | undefined> {
		if (!this.engine) return undefined
		const cached = this.tallies.get(id)
		if (cached) return cached
		const known = (await this.engine.tallies()).some(t => t.ref.id === id)
		if (!known) return undefined
		const opened = await this.engine.open({ id })
		this.tallies.set(id, opened)
		return opened
	}

	/** Every tally, read. */
	async views(): Promise<{ tally: Tally; view: TallyView }[]> {
		if (!this.engine) return []
		const out: { tally: Tally; view: TallyView }[] = []
		for (const summary of await this.engine.tallies()) {
			const tally = await this.tally(summary.ref.id)
			if (tally) out.push({ tally, view: await tally.read() })
		}
		return out
	}

	remember(id: string, tally: Tally): void {
		this.tallies.set(id, tally)
	}

	/** The unit a tally is in: agreed in its contract, or intended while it is still forming. */
	unitOf(view: TallyView): Unit {
		if (view.contract || view.offer) return { denom: view.denomination, scale: view.denominationScale }
		return this.local.units[view.ref.id] ?? { denom: view.denomination, scale: view.denominationScale }
	}

	/**
	 * Run the agent once more, after whatever is already running. Serialized, so two changes
	 * arriving together cannot both decide to publish the same terms.
	 */
	advance(): Promise<void> {
		this.runs++
		this.agentRun = this.agentRun.then(() => this.step()).catch(error => {
			console.warn('taleus-model agent:', error)
		})
		return this.agentRun
	}

	/** Resolves once the agent has nothing left in hand. */
	settled(): Promise<void> {
		return this.agentRun
	}

	/**
	 * The protocol steps that follow from the state of each tally, and that no person needs to
	 * decide: the inviter names a tally once the invitee is seated; each party publishes the terms
	 * it already chose; the inviter then proposes the contract. Accepting it is a decision, so the
	 * agent stops there -- the offer waits for a person.
	 */
	private async step(): Promise<void> {
		for (const { tally, view } of await this.views()) {
			if (view.counterparty.sid === '') {
				// Nobody has taken the other seat yet -- or they have, and only the stock party
				// can name the tally. `establish` says which, harmlessly, either way.
				if (view.role === 'stock') await tally.establish()
				continue
			}
			if (view.state === 'offered') {
				if (this.options.acceptOffers && view.offer?.by === 'them') await tally.acceptContract()
				continue
			}
			if (view.state !== 'forming') continue
			const intended = this.local.intended[view.ref.id]
			if (!intended) continue
			if (!view.terms.mine) {
				await tally.offerCredit({
					limit: { units: intended.creditLimit.units, denomination: view.denomination },
					callDays: intended.noticeDays,
				})
				continue
			}
			if (intended.propose && view.terms.theirs) {
				await tally.offerContract({
					contractCid: intended.propose.agreementId,
					denomination: this.local.units[view.ref.id]?.denom ?? view.denomination,
					denominationScale: this.local.units[view.ref.id]?.scale ?? view.denominationScale,
				})
			}
		}
	}
}
