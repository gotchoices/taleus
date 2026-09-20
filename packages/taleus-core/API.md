# taleus-core — the API surface

**Status: drafted, not implemented.** `src/api/types.ts` is the declared surface and compiles;
nothing behind it exists yet. This document is the argument for that shape — why these calls and
not others, and what each one is hiding.

`SPEC.md` says what this package is and must never become. This says what a consumer touches.

## Who it is for

Three hosts, none privileged:

- a **phone** — this repo's React Native app, and the MyCHIPs-style UI that follows it
- a **server** — `taleus-node`, or a company wiring tallies into an ERP, POS or accounting system
- a **test** — no network, no cadre, no clock it does not control

The app was *consulted* and is not the client. A screen wants `waitingOn: me | them`, a badge
count, a cross-tally attention list. Those are view models, and they belong in the app
(`SPEC.md` § What it is not). What all three hosts share is smaller and more durable: **enumerate
tallies, observe change, act on one.** That is the whole surface.

MyCHIPs is the other input. Its lesson is mostly about what to leave out — the API does not carry
draft chits, does not expose the `S`/`F` side codes, and does not make the caller reason in the
stock party's sign convention.

## The five decisions

### 1. Everything is from the acting party's perspective

The schema stores one signed balance in the stock party's frame; the foil reads its negation.
That convention is load-bearing *below* the seam and meaningless above it. A consumer asks "what
am I owed" and gets a number that is positive when they are owed.

So: no `Side` in the surface, no sign convention to remember, no `Ledger.Number`. `Role` exists —
`stock | foil`, spelled out — because a party genuinely needs to know which seat they hold. The
`'S'`/`'F'` codes do not escape `src/tally/`.

### 2. A refusal is a value; a fault is an exception

Every act is proposed to two engines that re-validate it independently. The counterparty's engine
declining is not exceptional — it is the system working — so it comes back as `Result<T>` carrying
a `Refusal`. A store that cannot be reached, or a programming mistake, throws.

`Refusal` keeps **both** a stable `code` to branch on and the schema `constraint` that fired. The
second is not debug decoration. The row-level suite asserts on constraint names, and that has
already caught a test passing on a SQL typo and a constraint that was dead code. An API reporting
only `{ kind: 'refused' }` would make the suite weaker the moment it moves up.

`refusedBy` distinguishes the ordinary case (`counterparty` — well-formed here, not agreed there)
from the serious one (`code: 'disagreement'` — the replicas reached different verdicts, and
neither copy should be trusted until someone understands why).

### 3. The core asserts time; the schema never reads it

Every replica re-validates every write, so a constraint that read a clock would have replicas
disagree about the same row (`SPEC.md` § 5). The rule runs one way only: **the creator asserts and
signs a date, and the counterparty judges whether it is reasonable** (`docs/timestamps.md`).

That assertion has to be made somewhere, and making every caller pass a date for every act is how
an API becomes unpleasant enough that people work around it. So the clock is in `Environment`,
defaulted, and overridable per act via `ActOptions.on`. A test fixes it and can then assert on a
signature.

`ActOptions.id` is there for the same reason in reverse: a record's identity is *inside* the
digest its signer signs, so the store cannot generate it. The core supplies one; a caller wanting
an idempotent retry or a reproducible test supplies its own.

### 4. Signing is an interface, not a key pair

`Signer` is `{ publicKey, sign(bytes): Promise<Hex> }` and nothing more. A phone's secure enclave,
a hardware token and a remote signing service can all implement it, and none of them will hand
over a secret. `sign` is async because those are.

Every act takes an optional `signer` because **a party holds several keys and chooses which one
signs** — a master key kept cold, a device key used daily (`docs/identity.md`,
`feat-master-key-custody`). An API that bound one key per engine would make key rotation
impossible to express.

### 5. Three balances, because one number answers the question badly

```
settled    signed, done, authoritative
projected  settled + every open lift pledge — where it lands if what is promised resolves
requested  open payment requests either way — binds nobody, gates nothing
```

This is the distinction MyCHIPs drew between good and pending chits, redrawn along a better line.
MyCHIPs split on **signature state** (draft / pending / good). Taleus splits on **obligation**: a
lift pledge is fully signed *and still conditional*, which is the honest description of a lift
leg, and a payment request is barely binding at all. An unsigned draft chit is a UI concept and
does not belong in a shared database.

`capacity` — what is left before a credit limit stops the next act, each direction — is derived
and is what a "can I spend this" check actually wants.

Two honesty notes the implementation must carry, not bury:

- `capacity` is an **optimistic** bound until `feat-schema-directional-reserve` lands: the engine's
  gates read the netted projection, so two lifts crossing in opposite directions can settle past a
  limit.
- An open pledge is never released on expiry (`feat-lift-timeout-release`), so a stale pledge
  depresses `projected` indefinitely.

## The shape

```ts
interface Taleus {
  identity: PartyIdentity
  tallies(): Promise<TallySummary[]>
  open(ref): Promise<Tally>
  invite(request): Promise<Result<PendingInvitation>>
  accept(ticket, request?): Promise<Result<Tally>>
  watch(listener): Unsubscribe
  close(): Promise<void>
}

interface Tally {
  read() / balances() / history() / requests() / keys()
  offerCredit() / offerContract() / acceptContract()
  pay() / requestPayment() / declinePayment()
  addKey() / revokeKey() / adoptCounterpartyKey()
  requestClose()
  lifts: LiftSurface
  watch(listener): Unsubscribe
}
```

`watch` is on both, and it is the piece that would have been easy to leave out. All three hosts
need to know something moved without polling: a phone wakes a screen, a server posts to an ERP, a
test awaits the counterparty's acceptance. The event is deliberately thin — *that* a tally changed
and roughly where — and the consumer re-reads what it cares about.

Lifts are **declared and not built**. `lifts.pending()` works, because an open pledge already
moves `projected` and already constrains what else a party may do; a consumer that could not see
one would be unable to explain its own balance. `lifts.propose()` returns
`{ code: 'unsupported' }`. Declaring the seam beats omitting it: a consumer can render "not yet"
rather than discover the capability is missing.

## A tally's whole life

```ts
const taleus = await openTaleus({ store, signer, sid })

// Jan forms a tally and holds a seat for Sam.
const invited = await taleus.invite({
  as: 'stock',
  denomination: 'iso:USD',
  offering: { limit: { units: 50000, denomination: 'iso:USD' }, callDays: 21 },
})
if (!invited.ok) return invited.refusal
show(invited.value.ticket.encoded)          // a QR, a link, an email

// Sam redeems it. One act: the strand seats him and the tally knows him.
const joined = await sam.accept(ticket, { certificate: samsCert })

// Both sides publish terms, then agree a contract.
await tally.offerCredit({ limit: zero, callDays: 21 })
await tally.offerContract({ contractCid: 'cid:standard-tally-v1' })
await peer.acceptContract()                  // state: 'open'

// Value moves. A party may always give, so this clears the counterparty's gate by construction.
await tally.pay({ amount: { units: 12000, denomination: 'iso:USD' }, memo: 'March hours' })

// Asking is not the same as being paid.
const req = await tally.requestPayment({ amount: { units: 8000, denomination: 'iso:USD' } })
const paid = await peer.pay({ amount: req.value.amount, answers: req.value.id })
if (!paid.ok && paid.refusal.code === 'credit-limit') {
  // The request was legitimate; the payer is out of room. Raise the limit or renegotiate.
}

// Winding down: unilateral, and it cannot trap the counterparty.
await tally.requestClose()
// growth frozen both ways; reduction still permitted; 'closed' only at an actual settled zero
```

## What is still open

- **The store seam is the one interface the API cannot finish.** `TallyStore` / `StoreProvider` are
  written as though a Sereus-backed implementation is coming, because one is
  (`feat-formation-over-sereus-strand`). Two questions from `SPEC.md` § Where Sereus plugs in remain,
  and both live behind this interface rather than in it: whether invite redemption and Taleus seating
  are one act, and **which transactor backs a tally strand** — the `quereus-sync` path fires no SQL
  constraints at all, which would silently void every gate in the schema.
- **`TallyState` is computed here**, because the schema does not materialize a negotiation state
  (`feat-schema-tally-state`). `forming` and `offered` are inferences from what has been signed.
  First thing to revisit when that ticket lands.
- **`PaymentRequest` cannot be withdrawn**, only declined by the payer, and it expires rather than
  ages (`feat-invoice-lifecycle`). The surface reflects today's schema; `requestPayment` gains a
  `withdraw` sibling when that lands.
- **No counter-offer.** `offerContract` overwrites a single mutable proposal row, so there is no
  offer history and no way to hold two live proposals (`feat-offer-lifecycle`).

## Migrating the tests

`test/STATUS.md` § Roadmap step 4 has the analysis. The dividing line is **not** happy path versus
refusal — most refusals express fine through an API, because the API takes signers as parameters.
The line is: *does the API compute the field under test?* Roughly 36 tests move up and read better
for it; 9 stay below, where the API computes the thing under attack or the concept is row-shaped;
~27 store-level tests never had an API to move to.
