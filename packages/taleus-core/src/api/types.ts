/**
 * The taleus-core API surface.
 *
 * A consumer carries a tally through its whole life here without knowing what a strand is,
 * what Quereus is, or that Optimystic exists (`SPEC.md` § 1, § 6). Three hosts are in view and
 * none of them is privileged: a phone, a server or ERP integration, and an automated test.
 *
 * Nothing in this file names a table, a column or a constraint. That is the seam: the row
 * builders in `src/tally/` speak the schema's language, and everything above this line speaks
 * the domain's. Where a schema concept has no domain meaning -- `Ledger.Number`, the `'S'`/`'F'`
 * side codes, the stock-perspective sign convention -- it does not appear at all.
 *
 * Two conventions run through the whole surface:
 *
 *   **Everything is from the acting party's own perspective.** No caller ever converts a
 *   stock-perspective balance, and no caller ever asks which side of the tally they are. A
 *   positive balance means value accumulated *by the reader*.
 *
 *   **A refusal is a value; a fault is an exception.** The counterparty's engine declining a
 *   write is an ordinary outcome of a distributed negotiation, so it comes back as `Refusal`
 *   carrying the reason -- including the schema constraint that fired, which is the detail an
 *   operator needs and the detail a flattened error would lose. A store that cannot be reached,
 *   or a programming mistake, throws.
 */

import type { RowWrite } from '../store/strand.js'

/* ── values ──────────────────────────────────────────────────────────────── */

/** Lowercase hex -- the schema's text form for keys, signatures and digests. */
export type Hex = string

/** An ISO calendar date (`YYYY-MM-DD`), asserted and signed by whoever wrote the record. */
export type IsoDate = string

/**
 * A quantity of value in one tally's unit of account.
 *
 * Units are always whole numbers of the smallest sub-unit, and the denomination travels with
 * them. Two amounts may only be added when their denominations match -- which is the whole
 * reason this is not a bare `number` (see `docs/denominations.md`, and
 * `feat-position-and-estimates` on why a single cross-tally total is a lie).
 */
export interface Amount {
	units: number
	denomination: string
}

/**
 * A fee ratio in parts per million: `10000` is 1%. Positive is a charge, negative a subsidy.
 * `1000000` on a clutch effectively blocks the movement it applies to.
 */
export type Ppm = number

/**
 * Which side of the tally a party sits on. `stock` is the party that accumulates value by
 * default -- a vendor, a lender, an employer; `foil` is the one that draws on the credit.
 */
export type Role = 'stock' | 'foil'

/**
 * Where a tally is in its life.
 *
 * `forming` and `offered` are derived from what has and has not been signed yet; the schema
 * does not materialize a negotiation state (`feat-schema-tally-state`), so these are computed
 * here and are the first thing to revisit when it does.
 */
export type TallyState = 'forming' | 'offered' | 'open' | 'closing' | 'closed'

/* ── results ─────────────────────────────────────────────────────────────── */

export type Result<T> = { ok: true; value: T } | { ok: false; refusal: Refusal }

/**
 * Why an act did not stand.
 *
 * `code` is the stable thing to branch on. `constraint` is the schema's own word for it, kept
 * because it is what makes a refusal diagnosable: the row-level suite asserts on it, and that
 * has already caught a test passing on a SQL typo and a constraint that was dead code. An API
 * that reported only "refused" would make the suite weaker the moment it moved up here.
 */
export interface Refusal {
	code: RefusalCode
	/** The schema constraint that fired, when the refusal came from the engine. */
	constraint?: string
	message: string
	/**
	 * Whose engine refused. `counterparty` is the ordinary case worth surfacing to a person --
	 * the act was well-formed here and the other side did not agree. `disagreement` as a *code*
	 * is the serious one: the replicas did not reach the same verdict.
	 */
	refusedBy: 'self' | 'counterparty' | 'both'
}

export type RefusalCode =
	/** The act would take the balance past a credit limit, settled or projected. */
	| 'credit-limit'
	/** The tally is closing, and this act would move the balance away from zero. */
	| 'closing'
	/** The signing key is not authorized to act for that party. */
	| 'not-authorized'
	/** A signature did not verify over the content it covers. */
	| 'bad-signature'
	/** A payment does not answer the request it names: wrong side, wrong amount, or already answered. */
	| 'request-mismatch'
	/** A record with that identity already exists. */
	| 'already-exists'
	/** Nothing here by that identity. */
	| 'not-found'
	/**
	 * The values do not hold together: a notice period too short, an expiry before its date, a
	 * bound below its target, a denomination that cannot change, an amount out of range.
	 */
	| 'terms'
	/** The two replicas did not agree. Neither copy should be trusted until it is understood. */
	| 'disagreement'
	/** A stub: the capability is declared but not built (lifts, network discovery). */
	| 'unsupported'
	/** The engine refused and the reason did not map onto anything above; read `constraint`. */
	| 'refused'

/* ── identity and signing ────────────────────────────────────────────────── */

/**
 * Something that can sign. Deliberately narrower than a key pair: a phone's secure enclave, a
 * hardware token or a remote signing service can implement this, and none of them will hand
 * over a secret. `sign` is async for exactly that reason (`SPEC.md` § 2).
 */
export interface Signer {
	readonly publicKey: Hex
	sign(message: Uint8Array): Promise<Hex>
}

/**
 * A signer whose secret half is in this process.
 *
 * Today's engine requires one, and says so in the types rather than accepting a `Signer` it
 * cannot actually use. The row builders in `src/tally/` sign synchronously, so widening to the
 * full `Signer` above means making them async -- worth doing, and a visible change rather than
 * a runtime surprise when someone passes an enclave.
 */
export interface LocalSigner extends Signer {
	readonly secretKey: Uint8Array
}

/**
 * A party, as this tally knows them.
 *
 * A `sid` is **strand-local** by design: one person is not one identity, and nothing here tries
 * to make them so (`docs/identity.md`). Real-world identifiers -- a company number, a licence,
 * a tax id -- belong in `certificate` as payload the parties exchange and judge for themselves.
 * No protocol rule ever reads it.
 */
export interface PartyIdentity {
	sid: string
	/**
	 * What this party has chosen to say about themselves: a company number, a licence, an
	 * address. Opaque -- no protocol rule reads it, and the parties judge for themselves whether
	 * what they have been given is adequate. Absent until someone publishes one.
	 */
	certificate?: unknown
}

/**
 * A party's assertion that they hold a fresh key, signed by that key. Travels out of band to
 * the counterparty, who attests it with `adoptCounterpartyKey`.
 */
export interface KeyClaim {
	publicKey: Hex
	selfSignature: Hex
}

/** A key that may sign for a party on this tally, and whether it still may. */
export interface KeyRecord {
	publicKey: Hex
	revision: number
	/** How it entered the set: a party's own addition, or a counterparty's adoption of theirs. */
	origin: 'added' | 'adopted'
	revoked: boolean
}

/* ── reading ─────────────────────────────────────────────────────────────── */

/** An opaque handle naming one tally within a host's storage. Never parsed by a consumer. */
export interface TallyRef {
	readonly id: string
}

/**
 * The three tiers of "what is this tally worth", which is the question every consumer actually
 * asks and the one a single number answers badly.
 *
 *   `settled`   -- signed, done, authoritative.
 *   `projected` -- settled plus every open lift pledge: where the balance lands if everything
 *                  currently promised resolves. The honest thing to show a person.
 *   `requested` -- open payment requests on either side. Binds nobody and gates nothing; it is
 *                  a statement of what someone has asked for.
 *
 * `capacity` is what remains before a credit limit stops the next act, in each direction.
 *
 * Caveat worth carrying: the engine's credit gates read the *netted* projection today, which
 * lets two lifts crossing in opposite directions settle past a limit
 * (`feat-schema-directional-reserve`). `capacity` is therefore an optimistic bound until that
 * lands.
 */
export interface Balances {
	settled: Amount
	projected: Amount
	requested: { toMe: Amount; byMe: Amount }
	capacity: { canReceive: Amount; canSend: Amount }
}

/**
 * A party's published lift policy -- what it will let automated credit clearing do to its
 * balance, and what that costs. Unilateral: each party signs its own, so a tally carries two.
 *
 * Every value is from the **publishing party's own perspective**, whichever seat they hold.
 * MyCHIPs made the same field mean "lift margin" or "drop margin" depending on the side; that
 * flip is gone (`docs/trading-variables.md`).
 *
 * Publishing nothing means trading at zero: lifts may pay this party's accumulated balance down
 * to nothing, free, and accumulate nothing beyond that.
 */
export interface TradingPolicy {
	revision: number
	/** Ideal balance to accumulate through lifts. Movement up to here carries no reward fee. */
	target: Amount
	/** The most this party will accrue through lifts. Never below `target`. */
	bound: Amount
	/** Charged on accumulation above `target`, up to `bound`. */
	reward: Ppm
	/** Charged on drops -- lifts that reduce what this party has accumulated. */
	clutch: Ppm
}

/**
 * A change to that policy. Each revision is a complete statement, so anything left out keeps
 * its current value rather than resetting -- the engine reads the standing revision and fills
 * the gaps.
 */
export interface TradingPolicyChange extends ActOptions {
	target?: Amount
	bound?: Amount
	reward?: Ppm
	clutch?: Ppm
}

/**
 * What a lift may move through this tally, per direction, and what it costs.
 *
 * A direction is named by its **receiver** -- the party whose balance rises. The counterparty
 * releases the same value, so `toMe` and `fromMe` are the same movement read from the two ends.
 * Both parties' variables price a single lift: the receiver's `reward` on what it accumulates,
 * and the releaser's `clutch` on the whole amount.
 *
 * Advisory. The hard gate on a lift pledge is the credit limit, not these numbers -- conformance
 * to a party's own published policy is enforced by its agent, since the pledge is self-signed.
 */
export interface LiftDirection {
	/** Units that may move with no reward fee. */
	free: Amount
	/** Further units beyond `free`, charged at `reward`. */
	rewarded: Amount
	/** The receiving party's charge on `rewarded` units. */
	reward: Ppm
	/** The releasing party's charge, applied to the whole amount moved. */
	clutch: Ppm
}

export interface LiftCapacity {
	/** Value that may come to me. */
	toMe: LiftDirection
	/** Value that may leave me. */
	fromMe: LiftDirection
}

/** The credit one party extends to the other, and the notice owed before withdrawing it. */
export interface CreditTerms {
	revision: number
	limit: Amount
	/** Days of notice a *restrictive* revision owes before it binds. */
	callDays: number
	effectiveFrom: IsoDate
	/** A filed revision that has not yet taken effect, if one is pending. */
	pending?: Omit<CreditTerms, 'pending'>
}

/** Everything a consumer needs to render or reason about one tally, in one read. */
export interface TallyView {
	ref: TallyRef
	role: Role
	state: TallyState
	denomination: string
	/** Decimal exponent: one `Amount.units` is 10^-scale of the denomination's display unit. */
	denominationScale: number
	me: PartyIdentity
	counterparty: PartyIdentity
	balances: Balances
	/** `mine` is the credit I extend to them; `theirs` is what they extend to me. */
	terms: { mine?: CreditTerms; theirs?: CreditTerms }
	/** Each party's published lift policy. Absent means they have published none. */
	trading: { mine?: TradingPolicy; theirs?: TradingPolicy }
	contract?: { cid: string; revision: number; agreedOn: IsoDate }
	createdAt: IsoDate
}

/** A tally in a list, without the cost of reading all of it. */
export interface TallySummary {
	ref: TallyRef
	role: Role
	state: TallyState
	counterparty: PartyIdentity
	settled: Amount
	projected: Amount
}

/**
 * One movement of value, from the reader's perspective: `units` positive means value came to
 * them. A payment that answered a request carries the request's id.
 */
export interface Entry {
	id: string
	at: IsoDate
	amount: Amount
	/** Positive to the reader, negative away from them. */
	direction: 'in' | 'out'
	balanceAfter: Amount
	origin: 'payment' | 'lift'
	requestId?: string
	reference?: string
	memo?: string
}

/** An open request for payment, from either side. */
export interface PaymentRequest {
	id: string
	/** Who asked to be paid. */
	from: 'me' | 'counterparty'
	amount: Amount
	requestedOn: IsoDate
	expiresOn?: IsoDate
	state: 'open' | 'paid' | 'declined' | 'expired'
	reference?: string
	memo?: string
}

export interface HistoryQuery {
	since?: IsoDate
	limit?: number
}

/* ── acting ──────────────────────────────────────────────────────────────── */

/**
 * What every signed act may override.
 *
 * `signer` matters because a party holds several keys and chooses which one signs -- a master
 * key kept cold, a device key used daily. `on` is the date the actor asserts and signs; the
 * core supplies today's from its clock, and nothing in the schema ever reads a clock, because
 * every replica re-validates every write (`SPEC.md` § 5, `docs/timestamps.md`).
 *
 * `id` exists because a record's identity is inside the digest its signer signs, so it cannot
 * be generated by the store. The core supplies one; a caller that needs an idempotent retry,
 * or a reproducible test, supplies its own.
 */
export interface ActOptions {
	signer?: LocalSigner
	on?: IsoDate
	id?: string
}

export interface Payment extends ActOptions {
	amount: Amount
	/** Answer an open request. The amount must match it exactly. */
	answers?: string
	reference?: string
	memo?: string
}

export interface PaymentRequestDraft extends ActOptions {
	amount: Amount
	expiresOn?: IsoDate
	reference?: string
	memo?: string
}

export interface CreditOffer extends ActOptions {
	/** What I am willing to let the counterparty owe me. */
	limit: Amount
	callDays: number
	/**
	 * When it binds. A raise takes effect at once; a reduction owes the counterparty the
	 * current `callDays` of notice, and the engine will refuse an earlier date.
	 */
	effectiveFrom?: IsoDate
}

export interface ContractOffer extends ActOptions {
	/** Content address of the contract text both parties are agreeing to. */
	contractCid: string
	/**
	 * The tally's unit of account, fixed for its life. It belongs here rather than on the
	 * invitation because it is a **bilateral** term: one shared value both parties sign, unlike
	 * credit limits, which each party sets alone. An invitation may advertise a denomination,
	 * but nothing is agreed until the contract is. Defaults to `CHIP` at scale 0.
	 */
	denomination?: string
	/** Decimal exponent: one unit is 10^-scale of the denomination's display unit. */
	denominationScale?: number
}

export interface KeyAddition extends ActOptions {
	/** The new key. It must sign for itself, proving the caller holds it. */
	key: LocalSigner
}

export interface KeyRevocation extends ActOptions {
	publicKey: Hex
}

/* ── formation ───────────────────────────────────────────────────────────── */

/**
 * An invitation, as it travels: a QR code, a link, an email. Opaque to a consumer -- it carries
 * the strand's address and the secret half of the invitation key, and the party that holds it
 * is the party entitled to take the open seat.
 */
export interface InvitationTicket {
	/**
	 * Which strand it admits the holder to. The store layer resolves this and nothing else --
	 * in a real host it is the strand's address, the thing a joiner dials.
	 */
	readonly ref: TallyRef
	/**
	 * The credential: the seat offered and the secret half of the invitation key. Opaque to the
	 * store, read only by the engine. Holding this is what entitles someone to the open seat.
	 */
	readonly encoded: string
}

/** An invitation the inviter is holding open, and can show or withdraw. */
export interface PendingInvitation {
	ticket: InvitationTicket
	ref: TallyRef
	/** The seat the *invitee* will take. */
	invitedAs: Role
	createdAt: IsoDate
}

export interface InviteRequest extends ActOptions {
	/** The seat I take; the invitee takes the other. */
	as: Role
	/** Advertised on the ticket so an invitee knows what is being proposed. Agreed in the contract. */
	denomination: string
	/** Optional opening position, so an invitee sees real terms rather than an empty tally. */
	offering?: { limit: Amount; callDays: number }
	certificate?: unknown
}

export interface AcceptRequest extends ActOptions {
	certificate?: unknown
}

/* ── change notification ─────────────────────────────────────────────────── */

export type Unsubscribe = () => void

export type ChangeKind = 'balance' | 'terms' | 'contract' | 'request' | 'keys' | 'close' | 'lift'

/**
 * Something moved. Deliberately thin -- it says *that* a tally changed and roughly where, not
 * what it now is. A consumer re-reads what it cares about.
 *
 * Every host needs this and none of them should poll: a phone wants to wake a screen, a server
 * wants to post to an ERP, a test wants to await the counterparty's acceptance.
 */
export interface Change {
	tally: TallyRef
	kind: ChangeKind
	at: IsoDate
}

/* ── lifts (declared, not built) ─────────────────────────────────────────── */

/**
 * A lift leg on this tally: signed, conditional, and reserving capacity until a referee
 * resolves it. Readable today, because an open pledge already moves `projected` and already
 * constrains what else a party can do -- a consumer that could not see one would be unable to
 * explain its own balance.
 */
export interface PendingLiftView {
	liftId: string
	amount: Amount
	direction: 'in' | 'out'
	pledgedOn: IsoDate
	/** Advisory only today: nothing releases a pledge on expiry (`feat-lift-timeout-release`). */
	expiresOn: IsoDate
}

/**
 * Distributed payments. The read side works; proposing one does not.
 *
 * Every method that would *initiate* a lift returns `unsupported` rather than being absent, so
 * the shape of the seam is visible and a consumer can render the capability as "not yet"
 * instead of discovering it is missing.
 */
export interface LiftSurface {
	pending(): Promise<PendingLiftView[]>
	/** What a lift could move through this tally right now, and what it would cost. */
	capacity(): Promise<LiftCapacity>
	/** Not built: `feat-lift-referee-commit`, `feat-chipnet-integration`. */
	propose(request: { amount: Amount; direction: 'in' | 'out' }): Promise<Result<never>>
}

/* ── the surfaces ────────────────────────────────────────────────────────── */

/**
 * One tally, from one party's side.
 *
 * Every mutating method is async and returns a `Result`, because every one of them is an act
 * proposed to two engines that each re-validate it independently.
 */
export interface Tally {
	readonly ref: TallyRef
	readonly role: Role

	read(): Promise<TallyView>
	balances(): Promise<Balances>
	history(query?: HistoryQuery): Promise<Entry[]>
	requests(): Promise<PaymentRequest[]>
	keys(): Promise<KeyRecord[]>

	/**
	 * Stock only: name the tally, once the counterparty has taken their seat.
	 *
	 * The tally's identity is a digest over *both* parties' sids, so it cannot exist until both
	 * are seated -- and only the stock party signs it. That makes this a real step rather than
	 * an implementation detail: between the invitee accepting and the inviter naming, nothing
	 * can be signed against the tally, because every other signature binds its id.
	 */
	establish(options?: ActOptions): Promise<Result<void>>

	/** Publish what I am willing to let them owe me. */
	offerCredit(offer: CreditOffer): Promise<Result<CreditTerms>>
	/**
	 * Publish what lifts may do to my balance, and what that costs. Unilateral, like credit --
	 * it obliges the counterparty to nothing and needs no agreement.
	 */
	setTradingPolicy(change: TradingPolicyChange): Promise<Result<TradingPolicy>>
	/** Propose the contract both sides sign to open the tally. */
	offerContract(offer: ContractOffer): Promise<Result<void>>
	/** Counter-sign a contract the counterparty proposed. */
	acceptContract(options?: ActOptions): Promise<Result<void>>

	/** Give value. Always permitted by the counterparty's gate -- a party may always give. */
	pay(payment: Payment): Promise<Result<Entry>>
	/** Ask to be paid. Binds nobody, and is not credit-gated. */
	requestPayment(draft: PaymentRequestDraft): Promise<Result<PaymentRequest>>
	/** Refuse a request addressed to me, on the record. */
	declinePayment(requestId: string, options?: ActOptions): Promise<Result<void>>

	/**
	 * Say more about who I am. Revisioned and signed, so what was claimed and when is on the
	 * record; the counterparty decides whether it satisfies them.
	 */
	publishCertificate(certificate: unknown, options?: ActOptions): Promise<Result<void>>

	addKey(addition: KeyAddition): Promise<Result<KeyRecord>>
	revokeKey(revocation: KeyRevocation): Promise<Result<void>>
	/**
	 * Produce a signed claim that I hold a fresh key, to hand to the counterparty out of band.
	 *
	 * Writes nothing. This is my half of the recovery ceremony -- the counterparty cannot make
	 * it, because they do not hold the key.
	 */
	claimKey(key: LocalSigner): Promise<KeyClaim>
	/**
	 * Attest a claim the counterparty made. The recovery path after a compromise: a sealed
	 * strand cannot re-admit a member, so a counterparty's adoption is the only way a party's
	 * signing key can change for the life of the tally (`docs/identity.md`).
	 *
	 * Two signatures, two parties, neither alone enough -- which is what makes this a
	 * negotiation rather than a claim. There is no other authority in a two-party strand.
	 */
	adoptCounterpartyKey(claim: KeyClaim, options?: ActOptions): Promise<Result<void>>

	/**
	 * Begin winding down. Unilateral and safe: it freezes balance growth in both directions
	 * while leaving reduction permitted, so the counterparty can always be paid down or lift
	 * the value out. The tally reaches `closed` only at an actual settled zero.
	 */
	requestClose(options?: ActOptions): Promise<Result<void>>

	readonly lifts: LiftSurface

	watch(listener: (change: Change) => void): Unsubscribe
	close(): Promise<void>
}

/**
 * The engine: one acting identity, over whatever tallies a host holds.
 *
 * A phone has one of these. So does an ERP adapter, and so does a test -- the difference is
 * entirely in the `Environment` it was built with.
 */
export interface Taleus {
	readonly identity: PartyIdentity

	tallies(): Promise<TallySummary[]>
	open(ref: TallyRef): Promise<Tally>

	/** Form a new tally and hold a seat open for someone. */
	invite(request: InviteRequest): Promise<Result<PendingInvitation>>
	/** Take the open seat on a tally someone invited me to. */
	accept(ticket: InvitationTicket, request?: AcceptRequest): Promise<Result<Tally>>

	/** Every tally at once -- what a list screen and a reconciliation job both need. */
	watch(listener: (change: Change) => void): Unsubscribe
	close(): Promise<void>
}

/* ── the host seam ───────────────────────────────────────────────────────── */

/**
 * What a tally's storage must be able to do.
 *
 * SQL is the currency here on purpose: this interface is *inside* the seam, not across it. The
 * schema is the source of truth and a Sereus-backed strand is a Quereus database too, so an
 * implementation that spoke anything else would be translating twice. What the interface buys
 * is that the Sereus adapter, the in-memory test store, and whatever a browser host does are
 * interchangeable to everything above.
 *
 * `apply` must be **atomic**: a tally seating is several rows that are one act, and a partial
 * application would leave a strand in a state the schema's constraints exclude.
 */
export interface TallyStore {
	query<T>(sql: string, params?: unknown[]): Promise<T[]>
	apply(writes: RowWrite[]): Promise<void>
	/**
	 * Fire after a transaction commits on **this replica**, naming the tables it touched.
	 *
	 * Naming the tables rather than just saying "something happened" is what lets the engine
	 * report a useful `ChangeKind` without re-reading everything. It is also the shape the
	 * distributed path will have: Quereus fires watchers post-commit for local writes, and
	 * `notifyExternalTableChange(table)` is the hook a replicated write will come in through.
	 */
	subscribe(listener: (tables: readonly string[]) => void): Unsubscribe
	close(): Promise<void>
}

export interface StoreProvider {
	list(): Promise<TallyRef[]>
	open(ref: TallyRef): Promise<TallyStore>
	/** Form a new strand, seat the creator, and return a store bound to it. */
	create(request: { denomination: string }): Promise<{ ref: TallyRef; store: TallyStore }>
	/** Redeem an invitation: join the strand and return a store bound to it. */
	join(ticket: InvitationTicket): Promise<{ ref: TallyRef; store: TallyStore }>
}

/**
 * Everything the core needs from its host, in one place.
 *
 * The clock and the id source are here rather than imported because both are non-deterministic,
 * and a test that cannot fix them cannot assert on a signature. Note which way the rule runs:
 * the *core* asserts a time and signs it, and the *schema* never reads one.
 */
export interface Environment {
	store: StoreProvider
	signer: LocalSigner
	sid: string
	now?: () => IsoDate
	newId?: () => string
	certificate?: unknown
}
