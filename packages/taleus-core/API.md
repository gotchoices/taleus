# taleus-core — the API surface

**Status: implemented over the in-memory strand fabric.** `src/api/types.ts` is the surface,
`src/api/engine.ts` the implementation, and `src/api/store-memory.ts` a `StoreProvider` that runs
several parties' replicas in one process. `src/api/engine.test.ts` carries two parties from an
invitation through payment, requests, credit revision, key rotation and close — 18 tests, all
through the API, none of them naming a table. The Sereus-backed `StoreProvider` is the piece still
missing.

This document is the argument for the shape — why these calls and not others, and what each one is
hiding.

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

## The seven decisions

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

Today the engine takes the narrower `LocalSigner`, which also carries the secret — because the row
builders in `src/tally/` sign synchronously, and widening them is a real refactor. That narrowing
is **in the types**, so nobody discovers it by passing an enclave and getting a runtime error.

Every act takes an optional `signer` because **a party holds several keys and chooses which one
signs** — a master key kept cold, a device key used daily (`docs/identity.md`,
`feat-master-key-custody`). An API that bound one key per engine would make key rotation
impossible to express.

### 5. Two signatures means two calls

Three records need a signature from each party: the contract, a key adoption, and (later) a lift
commit. In each, one half is made by someone who does not hold the other's key. So the surface
splits them: the first party produces something signed, it travels out of band, the second party
relays it alongside their own.

`claimKey` / `adoptCounterpartyKey` is the visible case — a party who has lost every device makes
the claim, and the counterparty attests it. Neither alone is enough, which is what makes recovery a
negotiation rather than an assertion. There is no other authority in a two-party strand.

Relaying a signature is safe wherever the digest covers every field, which it does in both cases: a
relayed contract signature cannot be attached to different terms, and a relayed key claim cannot be
attached to a different party.

### 6. What is bilateral belongs on the contract

Credit limits are unilateral — a party says alone how much it will be owed — so `offerCredit` is a
single-signature act and the counterparty's agreement is not sought. The **denomination** is not:
it is one shared value both parties sign, fixed for the tally's life. So it is a field of
`offerContract`, not of `invite`. An invitation may *advertise* a unit so an invitee knows what is
being proposed; nothing is agreed until the contract is.

### 7. Three balances, because one number answers the question badly

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
  establish()
  offerCredit() / setTradingPolicy() / offerContract() / acceptContract()
  pay() / requestPayment() / declinePayment()
  publishCertificate()
  addKey() / revokeKey() / claimKey() / adoptCounterpartyKey()
  requestClose()
  lifts: { pending(), capacity(), propose() }
  watch(listener): Unsubscribe
}
```

`watch` is on both, and it is the piece that would have been easy to leave out. All three hosts
need to know something moved without polling: a phone wakes a screen, a server posts to an ERP, a
test awaits the counterparty's acceptance. The event is deliberately thin — *that* a tally changed
and roughly where — and the consumer re-reads what it cares about.

**Trading variables** are here as `setTradingPolicy` and `lifts.capacity()`, even though no lift can
be proposed yet. They are a party's published, unilateral policy for what automated clearing may do
to its balance — eight values per tally, four per party, because balance is one signed number but
each party governs its own side of zero. The one departure from MyCHIPs is that a variable means the
same thing whichever seat publishes it; MyCHIPs made the same field a "lift margin" on a foil and a
"drop margin" on a stock, and dropping that flip costs no expressive power.

**Certificates** are how a party says who they are in the real world. A `Sid` is deliberately
anonymous and strand-local — one person is not one identity — so a certificate is opaque payload the
parties judge for themselves, and no protocol rule reads it. Exchanged during seating or published
later.

Lifts are **declared and mostly not built**. `lifts.pending()` works, because an open pledge already
moves `projected` and already constrains what else a party may do; a consumer that could not see
one would be unable to explain its own balance. `lifts.propose()` returns
`{ code: 'unsupported' }`. Declaring the seam beats omitting it: a consumer can render "not yet"
rather than discover the capability is missing.

## A tally's whole life

Taken from `src/api/engine.test.ts`, which runs it.

```ts
const jan = await openTaleus({ store: fabric.provider('jan'), signer, sid })

// Jan forms a tally and holds a seat for Sam.
const invited = must(await jan.invite({ as: 'stock', denomination: 'iso4217:USD' }))
show(invited.ticket.encoded)                 // a QR, a link, an email

// Sam redeems it: the strand admits him and he takes the open seat.
const samTally = must(await sam.accept(invited.ticket))
const janTally = await jan.open(invited.ref)

// Only now can the tally be named — its id is a digest over both parties — and only stock
// signs it. Until this lands, nothing else can be signed, because every other signature
// binds that id.
must(await janTally.establish())

// Credit is unilateral; the contract is bilateral and carries the unit of account.
must(await janTally.offerCredit({ limit: usd(50000), callDays: 21 }))
must(await samTally.offerCredit({ limit: usd(0), callDays: 21 }))
must(await janTally.offerContract({ contractCid: 'cid:standard-tally-v1',
                                    denomination: 'iso4217:USD', denominationScale: 2 }))
must(await samTally.acceptContract())        // state: 'open'

// Value moves. A party may always give, so this clears the counterparty's gate by construction.
must(await samTally.pay({ amount: usd(12000), memo: 'March hours' }))
;(await janTally.balances()).settled         // +12000 — Jan is owed
;(await samTally.balances()).settled         // -12000 — the same fact, his side of it

// Asking is not the same as being paid.
const asked = must(await janTally.requestPayment({ amount: usd(8000) }))
const paid = await samTally.pay({ amount: usd(8000), answers: asked.id })
if (!paid.ok && paid.refusal.code === 'credit-limit') {
  // The request was legitimate; the payer is out of room. `refusal.constraint` says which
  // gate — 'WithinCreditLimits' — for anyone who needs to know exactly.
}

// Winding down: unilateral, and it cannot trap the counterparty.
must(await janTally.requestClose())          // growth frozen both ways, reduction permitted
must(await janTally.pay({ amount: usd(30000) }))
;(await samTally.read()).state               // 'closed', at an actual settled zero
```

## What is still open

- **The store seam has an implementation waiting for it.** `@serfab/quereus-plugin-sereus` already
  binds a Quereus database to a strand, applies a sApp schema, and exposes `begin`/`commit` — so
  `TallyStore` / `StoreProvider` are an adapter away, not a research project
  (`feat-formation-over-sereus-strand`). One question from `SPEC.md` § Where Sereus plugs in remains
  behind the interface: whether invite redemption and Taleus seating commit as one act.
- **`watch` is built on the real path, and the distributed half of it is upstream work.**
  `TallyStore.subscribe` registers a Quereus `Database.watch` over the schema's base tables on the
  member's own replica, and the engine maps the tables a commit touched to a `ChangeKind`. That is
  the whole mechanism — there is no polling anywhere and no fabric-level shortcut. In memory it
  already delivers the counterparty's acts, because every replica commits in process. On the
  distributed backend a peer's write will arrive through `notifyExternalTableChange(table)`, which
  Quereus already exposes and the replication path does not yet call. When it does, this code does
  not change.
- **`TallyState` is computed here**, because the schema does not materialize a negotiation state
  (`feat-schema-tally-state`). `forming` and `offered` are inferences from what has been signed.
  First thing to revisit when that ticket lands.
- **`invite` does not carry opening terms.** A vendor's QR ought to propose a credit limit, and
  `InviteRequest.offering` was in the first draft. It cannot work: credit terms are signed against
  the tally's id, which does not exist until both parties are seated. Carrying them as unsigned
  ticket payload is possible and is what a real vendor flow wants; not built.
- **`Taleus.watch` subscribes to the tallies that exist when it is called.** A tally formed
  afterwards is not covered. The store layer should offer one stream per member rather than the
  engine gathering per-tally subscriptions; nothing needs it yet.
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
