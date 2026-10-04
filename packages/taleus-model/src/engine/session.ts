/**
 * One party's engine session: its identity, its device-local state, the taleus-core engine, and
 * the agent that carries out the protocol steps nobody has a screen for.
 */
import {
	createPartyIdentity,
	localSigner,
	openTaleus,
	type LocalSigner,
	type StoreProvider,
	type Taleus,
	type Tally,
	type TallyView,
} from 'taleus-core'

import type { NotificationSettings } from '../notifications.js'
import type { Rate } from '../rates.js'
import type { Settings } from '../settings.js'
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
 * Everything this device keeps that is not on any tally. Saved through the host's
 * `SessionStorage.state` after every change, when the host supplies one; the identity's secret
 * goes to `SessionStorage.identity` instead, which the host keeps in its platform's key store.
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
	settings: Omit<Settings, 'unitsHeld'>
	notifications: NotificationSettings
	rates: Rate[]
	deviceName: string
}

/** One durable text value the host keeps: the same shape as cadre-core's `DurableSlot`. */
export interface DurableText {
	/** The saved text, or `undefined` when none is saved. A read fault throws. */
	load(): Promise<string | undefined>
	save(text: string): Promise<void>
}

/**
 * Where a session keeps what must outlive the app: its device-local state, and its identity.
 * The identity slot holds a secret key -- on a phone, a secure-store entry, never plain storage.
 */
export interface SessionStorage {
	state: DurableText
	identity: DurableText
}

/** A fresh device: nothing chosen, nothing held. Never the mock's fixtures, which hold sample people. */
export function initialLocalState(): LocalState {
	return {
		displayName: '',
		disclosed: {},
		madeInvitations: [],
		answeredInvitations: {},
		intended: {},
		units: {},
		setAside: {},
		settings: {
			locale: 'en',
			displayUnit: 'CHIP',
			unitStyle: 'mark',
			appearance: 'system',
			availableLocales: [{ tag: 'en', name: 'English' }],
		},
		notifications: {
			permission: 'unasked',
			classes: [
				{ id: 'signature', delivery: 'interrupt' },
				{ id: 'asked', delivery: 'interrupt' },
				{ id: 'arrived', delivery: 'inform' },
				{ id: 'automatic', delivery: 'silent', fixed: true },
			],
			lockScreenDetail: 'minimal',
			backgroundParticipation: false,
			hasAlwaysOnDevice: false,
		},
		rates: [],
		deviceName: 'This device',
	}
}

export interface SessionOptions {
	store: StoreProvider
	/** An identity this party already has. Absent means first run: none until `createIdentity`. */
	identity?: PartyIdentity
	/** Called when a new identity is made. */
	onIdentityCreated?: (identity: PartyIdentity) => void
	/** Where to keep device-local state and the identity across restarts. Absent: memory only. */
	storage?: SessionStorage
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
	readonly local: LocalState = initialLocalState()
	identity: PartyIdentity | undefined
	engine: Taleus | undefined
	private readonly tallies = new Map<string, Tally>()
	private agentRun: Promise<void> = Promise.resolve()
	/** How many agent runs have been asked for -- lets a test tell "quiet" from "between steps". */
	runs = 0
	private unwatch: (() => void) | undefined
	/** Saves in order, so a later state never lands under an earlier one. */
	private saving: Promise<void> = Promise.resolve()

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
		// Kept before it is used: an identity that signed something and was then lost would
		// leave this party unable to act on its own tallies.
		await this.options.storage?.identity.save(serializeIdentity(identity))
		this.options.onIdentityCreated?.(identity)
		await this.start(identity)
		return identity
	}

	/** The identity the host kept, if any. A read fault throws, rather than minting a second identity. */
	async restoredIdentity(): Promise<PartyIdentity | undefined> {
		const text = await this.options.storage?.identity.load()
		return text === undefined ? undefined : parseIdentity(text)
	}

	/**
	 * Load the device-local state the host kept, over the initial one, so a field added since it
	 * was saved starts at its default. A read fault throws; an unreadable record is logged and
	 * ignored, which costs this device its local choices but no tally.
	 */
	async restoreState(): Promise<void> {
		const text = await this.options.storage?.state.load()
		if (text === undefined) return
		try {
			Object.assign(this.local, JSON.parse(text) as Partial<LocalState>)
		} catch (error) {
			console.warn('taleus-model: ignoring unreadable saved device state:', error)
		}
	}

	/** Record that device-local state changed: saved in the background, in order. */
	changed(): void {
		const storage = this.options.storage
		if (!storage) return
		const text = JSON.stringify(this.local)
		this.saving = this.saving
			.then(() => storage.state.save(text))
			.catch(error => console.warn('taleus-model: saving device state failed:', error))
	}

	/** Resolves once every save asked for so far has finished. */
	saved(): Promise<void> {
		return this.saving
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

/** The identity as kept: its sid (the genesis key's address, which survives a rotation) and current key. */
interface IdentityRecord {
	v: 1
	sid: string
	publicKey: string
	secretKey: string
}

function serializeIdentity(identity: PartyIdentity): string {
	const record: IdentityRecord = {
		v: 1,
		sid: identity.sid,
		publicKey: identity.signer.publicKey,
		secretKey: toHex(identity.signer.secretKey),
	}
	return JSON.stringify(record)
}

function parseIdentity(text: string): PartyIdentity {
	const record = JSON.parse(text) as Partial<IdentityRecord>
	if (record.v !== 1 || typeof record.sid !== 'string' || typeof record.publicKey !== 'string' || typeof record.secretKey !== 'string') {
		throw new Error('the kept identity is not one this version can read')
	}
	return { sid: record.sid, signer: localSigner({ publicKey: record.publicKey, secretKey: fromHex(record.secretKey) }) }
}

function toHex(bytes: Uint8Array): string {
	return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2)
	for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	return bytes
}
