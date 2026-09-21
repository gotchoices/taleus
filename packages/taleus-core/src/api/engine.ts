import { bytesToHex, hexToBytes } from '../lift/digest.js'
import { newInvitation, signText, type KeyPairText } from '../store/index.js'
import { issueChit } from '../tally/chits.js'
import { requestClose as closeRow } from '../tally/close.js'
import { createTally, seatFoil, seatStock } from '../tally/formation.js'
import { declineInvoice, requestPayment } from '../tally/invoices.js'
import { addKey as addKeyRow, adoptKey, revokeKey as revokeKeyRow } from '../tally/keys.js'
import {
	proposeContract,
	publishCreditTerms,
	signContract,
	type Side,
} from '../tally/negotiation.js'
import { attempt, locally, no, ok } from './refusal.js'
import type {
	ActOptions,
	Amount,
	Balances,
	Change,
	ContractOffer,
	CreditOffer,
	CreditTerms,
	Entry,
	Environment,
	Hex,
	HistoryQuery,
	InvitationTicket,
	InviteRequest,
	KeyAddition,
	KeyRecord,
	KeyRevocation,
	LiftSurface,
	LocalSigner,
	PaymentRequest,
	PaymentRequestDraft,
	PendingInvitation,
	PendingLiftView,
	Payment,
	Result,
	Role,
	Taleus,
	Tally,
	TallyRef,
	TallyState,
	TallyStore,
	TallySummary,
	TallyView,
	Unsubscribe,
} from './types.js'

/**
 * The engine: the domain over the schema.
 *
 * Everything here is translation. The row builders in `src/tally/` already know how to sign a
 * chit or a close request; what they do not know is which side the caller is, what the running
 * balance is, what the next ledger number is, or how to say no in a way a consumer can act on.
 * That is this file, and it is deliberately the only place that knows both languages.
 */

const PROTOCOL = 'taleus/1'

/** Adapt a key pair to a signer. The bridge until the row builders sign asynchronously. */
export function localSigner(pair: KeyPairText): LocalSigner {
	return {
		publicKey: pair.publicKey,
		secretKey: pair.secretKey,
		sign: async message => bytesToHex(hexToBytes(signText(pair, new TextDecoder().decode(message)))),
	}
}

const asPair = (signer: LocalSigner): KeyPairText => ({
	publicKey: signer.publicKey,
	secretKey: signer.secretKey,
})

const amount = (units: number, denomination: string): Amount => ({
	// `Balance * -1` on a zero is `-0`, which `Object.is` and deep-equality both notice.
	units: (units ?? 0) + 0,
	denomination,
})

const sideOf = (role: Role): Side => (role === 'stock' ? 'S' : 'F')
const other = (role: Role): Role => (role === 'stock' ? 'foil' : 'stock')

interface Core {
	Cid: string
	StockSid: string
	FoilSid: string
	CreatedAt: string
}

class TallyEngine implements Tally {
	constructor(
		readonly ref: TallyRef,
		readonly role: Role,
		private readonly store: TallyStore,
		private readonly env: Required<Pick<Environment, 'signer' | 'sid'>> & Environment,
	) {}

	private get side(): Side {
		return sideOf(this.role)
	}

	private now(): string {
		return this.env.now ? this.env.now() : new Date().toISOString().slice(0, 10)
	}

	private newId(): string {
		return this.env.newId ? this.env.newId() : `id:${bytesToHex(randomBytes(12))}`
	}

	private act(options?: ActOptions) {
		return {
			signer: asPair(options?.signer ?? this.env.signer),
			on: options?.on ?? this.now(),
			id: options?.id ?? this.newId(),
		}
	}

	private async one<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
		return (await this.store.query<T>(sql, params))[0]
	}

	private async core(): Promise<Core | undefined> {
		return this.one<Core>('select Cid, StockSid, FoilSid, CreatedAt from TallyCore')
	}

	/** Every act after formation binds the tally's id, so most of them need this first. */
	private async requireCore(): Promise<Core> {
		const core = await this.core()
		if (!core) {
			throw new NotEstablished()
		}
		return core
	}

	private async denomination(): Promise<{ code: string; scale: number }> {
		const row = await this.one<{ Denomination: string; DenominationScale: number }>(
			'select Denomination, DenominationScale from TallyContract order by Number desc limit 1',
		)
		const proposal = row
			? undefined
			: await this.one<{ Denomination: string; DenominationScale: number }>(
					'select Denomination, DenominationScale from TallyContractProposal',
				)
		const chosen = row ?? proposal
		return { code: chosen?.Denomination ?? 'CHIP', scale: chosen?.DenominationScale ?? 0 }
	}

	private async state(): Promise<TallyState> {
		if (!(await this.core())) return 'forming'
		const contract = await this.one<{ Number: number }>('select Number from TallyContract limit 1')
		if (!contract) {
			const proposal = await this.one('select SequenceNumber from TallyContractProposal')
			return proposal ? 'offered' : 'forming'
		}
		const close = await this.one<{ State: TallyState }>('select State from CloseState')
		return close?.State ?? 'open'
	}

	/* ── reading ─────────────────────────────────────────────────────────── */

	async read(): Promise<TallyView> {
		const core = await this.core()
		const { code, scale } = await this.denomination()
		const mySid = this.env.sid
		const theirSid = core ? (core.StockSid === mySid ? core.FoilSid : core.StockSid) : ''
		return {
			ref: this.ref,
			role: this.role,
			state: await this.state(),
			denomination: code,
			denominationScale: scale,
			me: { sid: mySid },
			counterparty: { sid: theirSid },
			balances: await this.balances(),
			terms: {
				mine: await this.termsOf(mySid, code),
				theirs: theirSid ? await this.termsOf(theirSid, code) : undefined,
			},
			...(await this.contractView()),
			createdAt: core?.CreatedAt ?? '',
		}
	}

	private async contractView(): Promise<Pick<TallyView, 'contract'>> {
		const row = await this.one<{ Number: number; ContractCid: string }>(
			'select Number, ContractCid from TallyContract order by Number desc limit 1',
		)
		if (!row) return {}
		return {
			contract: { cid: row.ContractCid, revision: row.Number, agreedOn: (await this.core())?.CreatedAt ?? '' },
		}
	}

	private async termsOf(sid: string, denomination: string): Promise<CreditTerms | undefined> {
		const filed = await this.store.query<{
			Revision: number
			CreditLimit: number
			CallDays: number
			EffectiveDate: string
		}>(
			`select Revision, CreditLimit, CallDays, EffectiveDate from CreditTerms
			 where Sid = ? order by Revision desc`,
			[sid],
		)
		if (filed.length === 0) return undefined
		const inForce = await this.one<{ CreditLimit: number }>(
			'select CreditLimit from CurrentCreditLimit where Sid = ?',
			[sid],
		)
		// The newest revision is not necessarily the one governing: a restrictive change owes
		// notice, and until that passes an earlier revision is still what binds.
		const effective =
			filed.find(r => r.CreditLimit === inForce?.CreditLimit) ?? filed[filed.length - 1]
		const latest = filed[0]
		const shape = (r: (typeof filed)[number]): Omit<CreditTerms, 'pending'> => ({
			revision: r.Revision,
			limit: amount(r.CreditLimit, denomination),
			callDays: r.CallDays,
			effectiveFrom: r.EffectiveDate,
		})
		return {
			...shape(effective),
			...(latest.Revision !== effective.Revision ? { pending: shape(latest) } : {}),
		}
	}

	async balances(): Promise<Balances> {
		const { code } = await this.denomination()
		const mySid = this.env.sid
		const settled = await this.one<{ Balance: number }>(
			'select Balance from PerspectiveBalance where Sid = ?',
			[mySid],
		)
		const projected = await this.one<{ Balance: number }>(
			'select Balance from ReservedPerspectiveBalance where Sid = ?',
			[mySid],
		)
		const asked = await this.store.query<{ Requester: Side; Units: number }>(
			'select Requester, Units from OpenInvoice',
		)
		const sum = (which: Side) =>
			asked.filter(r => r.Requester === which).reduce((n, r) => n + r.Units, 0)

		const settledUnits = (settled?.Balance ?? 0) + 0
		const projectedUnits = (projected?.Balance ?? 0) + 0
		return {
			settled: amount(settledUnits, code),
			projected: amount(projectedUnits, code),
			requested: {
				toMe: amount(sum(this.side), code),
				byMe: amount(sum(this.side === 'S' ? 'F' : 'S'), code),
			},
			capacity: await this.capacity(settledUnits, projectedUnits, code),
		}
	}

	/**
	 * What is left before a credit limit stops the next act, in each direction.
	 *
	 * Both gates are consulted -- the settled balance and the projected one -- and the tighter
	 * wins, because the engine checks both. It is an **optimistic** bound while the projection
	 * nets opposite-direction pledges (`feat-schema-directional-reserve`).
	 */
	private async capacity(settled: number, projected: number, code: string): Promise<Balances['capacity']> {
		const core = await this.core()
		if (!core) return { canReceive: amount(0, code), canSend: amount(0, code) }
		const theirSid = core.StockSid === this.env.sid ? core.FoilSid : core.StockSid
		const limit = async (sid: string) =>
			(await this.one<{ CreditLimit: number }>(
				'select CreditLimit from CurrentCreditLimit where Sid = ?',
				[sid],
			))?.CreditLimit ?? 0
		const mine = await limit(this.env.sid)
		const theirs = await limit(theirSid)
		const room = (headroom: number) => Math.max(0, headroom)
		return {
			// My own limit caps how far I may be owed; theirs caps how far I may owe.
			canReceive: amount(room(Math.min(mine - settled, mine - projected)), code),
			canSend: amount(room(Math.min(theirs + settled, theirs + projected)), code),
		}
	}

	async history(query?: HistoryQuery): Promise<Entry[]> {
		const { code } = await this.denomination()
		const mine = this.side === 'S' ? 'F' : 'S' // the issuer whose chit raises MY balance
		const sign = this.role === 'stock' ? 1 : -1
		const rows = await this.store.query<{
			Id: string
			Issuer: Side
			Units: number
			Date: string
			Balance: number
			Kind: string
			InvoiceId: string | null
			Reference: string
			Memo: string
		}>(
			`select Id, Issuer, Units, Date, Balance, Kind, InvoiceId, Reference, Memo from Ledger
			 ${query?.since ? 'where DayNumber(Date) >= DayNumber(?)' : ''}
			 order by Number desc ${query?.limit ? 'limit ?' : ''}`,
			[...(query?.since ? [query.since] : []), ...(query?.limit ? [query.limit] : [])],
		)
		return rows.map(r => ({
			id: r.Id,
			at: r.Date,
			amount: amount(r.Units, code),
			direction: r.Issuer === mine ? 'in' : 'out',
			balanceAfter: amount(r.Balance * sign, code),
			origin: r.Kind === 'lift' ? 'lift' : 'payment',
			...(r.InvoiceId ? { requestId: r.InvoiceId } : {}),
			...(r.Reference ? { reference: r.Reference } : {}),
			...(r.Memo ? { memo: r.Memo } : {}),
		}))
	}

	async requests(): Promise<PaymentRequest[]> {
		const { code } = await this.denomination()
		const rows = await this.store.query<{
			Id: string
			Requester: Side
			Units: number
			Date: string
			ExpiryDate: string | null
			State: PaymentRequest['state']
		}>('select Id, Requester, Units, Date, ExpiryDate, State from InvoiceState')
		return rows.map(r => ({
			id: r.Id,
			from: r.Requester === this.side ? 'me' : 'counterparty',
			amount: amount(r.Units, code),
			requestedOn: r.Date,
			...(r.ExpiryDate ? { expiresOn: r.ExpiryDate } : {}),
			state: r.State,
		}))
	}

	async keys(): Promise<KeyRecord[]> {
		const added = await this.store.query<{ PublicKey: string; Revision: number }>(
			'select PublicKey, Revision from PartyKey where Sid = ? order by Revision',
			[this.env.sid],
		)
		const adopted = await this.store.query<{ PublicKey: string }>(
			'select PublicKey from PartyKeyAdoption where Sid = ?',
			[this.env.sid],
		)
		const revoked = new Set(
			(
				await this.store.query<{ PublicKey: string }>(
					'select PublicKey from PartyKeyRevocation where Sid = ?',
					[this.env.sid],
				)
			).map(r => r.PublicKey),
		)
		return [
			...added.map(k => ({
				publicKey: k.PublicKey,
				revision: k.Revision,
				origin: 'added' as const,
				revoked: revoked.has(k.PublicKey),
			})),
			...adopted.map(k => ({
				publicKey: k.PublicKey,
				revision: 0,
				origin: 'adopted' as const,
				revoked: revoked.has(k.PublicKey),
			})),
		]
	}

	/* ── acting ──────────────────────────────────────────────────────────── */

	async establish(options?: ActOptions): Promise<Result<void>> {
		if (this.role !== 'stock') {
			return no(locally('not-authorized', 'only the stock party names the tally'))
		}
		if (await this.core()) {
			return no(locally('already-exists', 'this tally is already established'))
		}
		const stock = await this.one<{ Sid: string }>('select Sid from Stock')
		const foil = await this.one<{ Sid: string }>('select Sid from Foil')
		if (!stock || !foil) {
			return no(locally('not-found', 'the counterparty has not taken their seat yet'))
		}
		const { signer, on } = this.act(options)
		return attempt(async () => {
			await this.store.apply(
				createTally({
					stockSid: stock.Sid,
					foilSid: foil.Sid,
					protocolVersion: PROTOCOL,
					createdAt: on,
					signer,
				}),
			)
		})
	}

	async offerCredit(offer: CreditOffer): Promise<Result<CreditTerms>> {
		return this.guarded(async core => {
			const { signer, on } = this.act(offer)
			const prior = await this.one<{ Revision: number }>(
				'select max(Revision) as Revision from CreditTerms where Sid = ?',
				[this.env.sid],
			)
			const revision = (prior?.Revision ?? 0) + 1
			await this.store.apply([
				publishCreditTerms({
					sid: this.env.sid,
					tallyCid: core.Cid,
					revision,
					creditLimit: offer.limit.units,
					callDays: offer.callDays,
					date: on,
					effectiveDate: offer.effectiveFrom ?? on,
					signer,
				}),
			])
			return {
				revision,
				limit: offer.limit,
				callDays: offer.callDays,
				effectiveFrom: offer.effectiveFrom ?? on,
			}
		})
	}

	async offerContract(offer: ContractOffer): Promise<Result<void>> {
		return this.guarded(async core => {
			const { signer } = this.act(offer)
			const revisions = await this.termsRevisions(core)
			if (!revisions) throw new MissingTerms()
			await this.store.apply([
				proposeContract({
					tallyCid: core.Cid,
					sequenceNumber: 1,
					contractCid: offer.contractCid,
					proposer: this.side,
					...revisions,
					...(offer.denomination ? { denomination: offer.denomination } : {}),
					...(offer.denominationScale !== undefined
						? { denominationScale: offer.denominationScale }
						: {}),
					signer,
				}),
			])
		})
	}

	async acceptContract(options?: ActOptions): Promise<Result<void>> {
		return this.guarded(async core => {
			const proposal = await this.one<{
				SequenceNumber: number
				ContractCid: string
				Proposer: Side
				StockCreditTermsRevision: number
				FoilCreditTermsRevision: number
				Denomination: string
				DenominationScale: number
				SignerKey: string
				ContractSignature: string
			}>('select * from TallyContractProposal')
			if (!proposal) throw new NoProposal()
			const { signer } = this.act(options)
			await this.store.apply([
				signContract({
					tallyCid: core.Cid,
					number: proposal.SequenceNumber,
					contractCid: proposal.ContractCid,
					stockCreditTermsRevision: proposal.StockCreditTermsRevision,
					foilCreditTermsRevision: proposal.FoilCreditTermsRevision,
					denomination: proposal.Denomination,
					denominationScale: proposal.DenominationScale,
					proposer: proposal.Proposer,
					proposerSignerKey: proposal.SignerKey,
					proposerSignature: proposal.ContractSignature,
					accepter: signer,
				}),
			])
		})
	}

	private async termsRevisions(
		core: Core,
	): Promise<{ stockCreditTermsRevision: number; foilCreditTermsRevision: number } | undefined> {
		const latest = async (sid: string) =>
			(
				await this.one<{ Revision: number }>(
					'select max(Revision) as Revision from CreditTerms where Sid = ?',
					[sid],
				)
			)?.Revision
		const stock = await latest(core.StockSid)
		const foil = await latest(core.FoilSid)
		if (stock === undefined || stock === null || foil === undefined || foil === null) return undefined
		return { stockCreditTermsRevision: stock, foilCreditTermsRevision: foil }
	}

	async pay(payment: Payment): Promise<Result<Entry>> {
		return this.guarded(async core => {
			const { signer, on, id } = this.act(payment)
			const contract = await this.one<{ Number: number }>(
				'select Number from TallyContract order by Number desc limit 1',
			)
			if (!contract) throw new NotOpen()
			const last = await this.one<{ Number: number; Balance: number }>(
				'select Number, Balance from Ledger order by Number desc limit 1',
			)
			// `Balance` is the stock party's perspective throughout the ledger; a chit from the
			// foil raises it. Giving therefore lowers the giver's own perspective balance.
			const delta = this.side === 'F' ? payment.amount.units : -payment.amount.units
			await this.store.apply([
				issueChit({
					tallyCid: core.Cid,
					contractNumber: contract.Number,
					number: (last?.Number ?? 0) + 1,
					id,
					issuer: this.side,
					issuerSid: this.env.sid,
					units: payment.amount.units,
					date: on,
					balance: (last?.Balance ?? 0) + delta,
					...(payment.answers ? { invoiceId: payment.answers } : {}),
					...(payment.reference ? { reference: payment.reference } : {}),
					...(payment.memo ? { memo: payment.memo } : {}),
					signer,
				}),
			])
			return {
				id,
				at: on,
				amount: payment.amount,
				direction: 'out' as const,
				balanceAfter: amount(
					((last?.Balance ?? 0) + delta) * (this.role === 'stock' ? 1 : -1),
					payment.amount.denomination,
				),
				origin: 'payment' as const,
				...(payment.answers ? { requestId: payment.answers } : {}),
			}
		})
	}

	async requestPayment(draft: PaymentRequestDraft): Promise<Result<PaymentRequest>> {
		return this.guarded(async core => {
			const { signer, on, id } = this.act(draft)
			await this.store.apply([
				requestPayment({
					tallyCid: core.Cid,
					id,
					requester: this.side,
					units: draft.amount.units,
					date: on,
					...(draft.expiresOn ? { expiryDate: draft.expiresOn } : {}),
					...(draft.reference ? { reference: draft.reference } : {}),
					...(draft.memo ? { memo: draft.memo } : {}),
					signer,
				}),
			])
			return {
				id,
				from: 'me' as const,
				amount: draft.amount,
				requestedOn: on,
				...(draft.expiresOn ? { expiresOn: draft.expiresOn } : {}),
				state: 'open' as const,
			}
		})
	}

	async declinePayment(requestId: string, options?: ActOptions): Promise<Result<void>> {
		return this.guarded(async core => {
			const { signer } = this.act(options)
			await this.store.apply([
				declineInvoice({
					tallyCid: core.Cid,
					invoiceId: requestId,
					declinedBy: this.side,
					signer,
				}),
			])
		})
	}

	async addKey(addition: KeyAddition): Promise<Result<KeyRecord>> {
		return this.guarded(async () => {
			const { signer } = this.act(addition)
			const prior = await this.one<{ Revision: number }>(
				'select max(Revision) as Revision from PartyKey where Sid = ?',
				[this.env.sid],
			)
			const revision = (prior?.Revision ?? 0) + 1
			await this.store.apply([
				addKeyRow({
					sid: this.env.sid,
					key: asPair(addition.key),
					by: signer,
					revision,
				}),
			])
			return { publicKey: addition.key.publicKey, revision, origin: 'added' as const, revoked: false }
		})
	}

	async revokeKey(revocation: KeyRevocation): Promise<Result<void>> {
		return this.guarded(async () => {
			const { signer } = this.act(revocation)
			await this.store.apply([
				revokeKeyRow({ sid: this.env.sid, publicKey: revocation.publicKey, by: signer }),
			])
		})
	}

	async adoptCounterpartyKey(publicKey: Hex, options?: ActOptions): Promise<Result<void>> {
		return this.guarded(async core => {
			const { signer } = this.act(options)
			const theirSid = core.StockSid === this.env.sid ? core.FoilSid : core.StockSid
			await this.store.apply([
				adoptKey({
					sid: theirSid,
					key: { publicKey, secretKey: new Uint8Array() },
					counterparty: signer,
				}),
			])
		})
	}

	async requestClose(options?: ActOptions): Promise<Result<void>> {
		return this.guarded(async core => {
			const { signer, on } = this.act(options)
			await this.store.apply([
				closeRow({ tallyCid: core.Cid, requester: this.side, date: on, signer }),
			])
		})
	}

	readonly lifts: LiftSurface = {
		pending: async (): Promise<PendingLiftView[]> => {
			const { code } = await this.denomination()
			const rows = await this.store.query<{
				LiftId: string
				Issuer: Side
				Units: number
				Date: string
				Expiry: string
			}>('select LiftId, Issuer, Units, Date, Expiry from OpenPendingLift')
			const raises = this.side === 'S' ? 'F' : 'S'
			return rows.map(r => ({
				liftId: r.LiftId,
				amount: amount(r.Units, code),
				direction: r.Issuer === raises ? 'in' : 'out',
				pledgedOn: r.Date,
				expiresOn: r.Expiry,
			}))
		},
		propose: async (): Promise<Result<never>> =>
			no(locally('unsupported', 'proposing a lift needs feat-lift-referee-commit')),
	}

	watch(listener: (change: Change) => void): Unsubscribe {
		return this.store.subscribe(() => {
			listener({ tally: this.ref, kind: 'balance', at: this.now() })
		})
	}

	async close(): Promise<void> {
		await this.store.close()
	}

	/** Every act after formation needs the tally's id; this is where that precondition lives. */
	private async guarded<T>(act: (core: Core) => Promise<T>): Promise<Result<T>> {
		let core: Core
		try {
			core = await this.requireCore()
		} catch (error) {
			if (error instanceof NotEstablished) {
				return no(locally('not-found', 'this tally has not been established yet'))
			}
			throw error
		}
		try {
			return await attempt(() => act(core))
		} catch (error) {
			if (error instanceof MissingTerms) {
				return no(locally('not-found', 'both parties must publish credit terms before an offer'))
			}
			if (error instanceof NoProposal) {
				return no(locally('not-found', 'there is no standing offer to accept'))
			}
			if (error instanceof NotOpen) {
				return no(locally('not-found', 'the tally has no agreed contract yet'))
			}
			throw error
		}
	}
}

class NotEstablished extends Error {}
class MissingTerms extends Error {}
class NoProposal extends Error {}
class NotOpen extends Error {}

/* ── the engine ──────────────────────────────────────────────────────────── */

class TaleusEngine implements Taleus {
	readonly identity: { sid: string }
	private readonly watchers = new Set<Unsubscribe>()

	constructor(private readonly env: Environment) {
		this.identity = { sid: env.sid }
	}

	private now(): string {
		return this.env.now ? this.env.now() : new Date().toISOString().slice(0, 10)
	}

	private async roleOn(store: TallyStore): Promise<Role> {
		const core = (await store.query<Core>('select StockSid, FoilSid from TallyCore'))[0]
		if (core) return core.StockSid === this.env.sid ? 'stock' : 'foil'
		const stock = (await store.query<{ Sid: string }>('select Sid from Stock'))[0]
		return stock?.Sid === this.env.sid ? 'stock' : 'foil'
	}

	async open(ref: TallyRef): Promise<Tally> {
		const store = await this.env.store.open(ref)
		return new TallyEngine(ref, await this.roleOn(store), store, {
			...this.env,
			signer: this.env.signer,
			sid: this.env.sid,
		})
	}

	async tallies(): Promise<TallySummary[]> {
		const summaries: TallySummary[] = []
		for (const ref of await this.env.store.list()) {
			const tally = await this.open(ref)
			const view = await tally.read()
			summaries.push({
				ref,
				role: view.role,
				state: view.state,
				counterparty: view.counterparty,
				settled: view.balances.settled,
				projected: view.balances.projected,
			})
		}
		return summaries
	}

	async invite(request: InviteRequest): Promise<Result<PendingInvitation>> {
		const { ref, store } = await this.env.store.create({ denomination: request.denomination })
		const invitation = newKeyPair()
		const on = request.on ?? this.now()
		const seat = request.as === 'stock' ? seatStock : seatFoil
		const result = await attempt(async () => {
			await store.apply(
				seat({
					sid: this.env.sid,
					genesis: asPair(request.signer ?? this.env.signer),
					invitation,
				}),
			)
		})
		if (!result.ok) return no(result.refusal)
		const ticket = encodeTicket(ref, other(request.as), invitation, request.denomination)
		return ok({ ticket, ref, invitedAs: other(request.as), createdAt: on })
	}

	async accept(ticket: InvitationTicket, request?: ActOptions): Promise<Result<Tally>> {
		const decoded = decodeTicket(ticket)
		if (!decoded) return no(locally('not-found', 'that invitation cannot be read'))
		const { ref, store } = await this.env.store.join(ticket)
		const seat = decoded.role === 'stock' ? seatStock : seatFoil
		const result = await attempt(async () => {
			await store.apply(
				seat({
					sid: this.env.sid,
					genesis: asPair(request?.signer ?? this.env.signer),
					invitation: decoded.invitation,
				}),
			)
		})
		if (!result.ok) return no(result.refusal)
		return ok(
			new TallyEngine(ref, decoded.role, store, {
				...this.env,
				signer: this.env.signer,
				sid: this.env.sid,
			}),
		)
	}

	watch(listener: (change: Change) => void): Unsubscribe {
		// Per-tally subscriptions, gathered. A host with many tallies will want the store layer
		// to offer one stream; nothing needs that yet.
		let live = true
		void (async () => {
			for (const ref of await this.env.store.list()) {
				if (!live) return
				const tally = await this.open(ref)
				this.watchers.add(tally.watch(listener))
			}
		})()
		return () => {
			live = false
			for (const stop of this.watchers) stop()
			this.watchers.clear()
		}
	}

	async close(): Promise<void> {
		for (const stop of this.watchers) stop()
		this.watchers.clear()
	}
}

/* ── tickets ─────────────────────────────────────────────────────────────── */

interface DecodedTicket {
	/** The seat the holder takes. */
	role: Role
	invitation: { publicKey: string; secretKey: Uint8Array }
	denomination: string
}

/**
 * What travels out of band. The secret half of the invitation key is in here, which is the
 * whole point: holding this ticket is what entitles someone to the open seat.
 */
function encodeTicket(
	ref: TallyRef,
	role: Role,
	invitation: { publicKey: string; secretKey: Uint8Array },
	denomination: string,
): InvitationTicket {
	const body = JSON.stringify({
		role,
		key: invitation.publicKey,
		secret: bytesToHex(invitation.secretKey),
		denomination,
	})
	return { ref, encoded: `taleus:invite:${body}` }
}

function decodeTicket(ticket: InvitationTicket): DecodedTicket | undefined {
	if (!ticket.encoded.startsWith('taleus:invite:')) return undefined
	try {
		const body = JSON.parse(ticket.encoded.slice('taleus:invite:'.length)) as Record<string, string>
		return {
			role: body.role as Role,
			invitation: { publicKey: body.key, secretKey: hexToBytes(body.secret) },
			denomination: body.denomination,
		}
	} catch {
		return undefined
	}
}

/* ── construction ────────────────────────────────────────────────────────── */

export async function openTaleus(env: Environment): Promise<Taleus> {
	return new TaleusEngine(env)
}

/* Local helpers kept out of the public surface. */

function randomBytes(n: number): Uint8Array {
	const out = new Uint8Array(n)
	for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256)
	return out
}

function newKeyPair(): { publicKey: string; secretKey: Uint8Array } {
	// Deliberately the same generator the rest of the core uses.
	return newInvitation()
}
