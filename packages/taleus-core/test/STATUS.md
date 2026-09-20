# taleus-core — test inventory

Every test we can currently conceive for the core, whether written or not. This file is the
checklist the build works down; it is **not timeless** — a line goes away when it is covered and the
coverage is obvious from the suite itself.

Scope for now: **tally negotiation, tally management, and direct payments.** Network queries and
lifts are stubs; the lift module already has its own in-process suite (`src/lift/*.test.ts`) against
test doubles, and re-grounding that on the real schema comes after direct chits work.

## Roadmap — agreed sequencing

Where this is going, in order. Written to survive a context compaction: enough detail that the
next session can pick up without re-deriving the reasoning.

### Step 1 — direct chits, at the schema level *(in progress)*

Finish § 6 below on the current substrate. The credit gate is the heart of the system and the
row-level harness is the right tool for it: an API does not yet exist, and building one over an
unexercised gate would bake in whatever is wrong with it.

### Step 2 — the Sereus seam

**Formation is settled**: [`docs/formation.md`](../../../docs/formation.md) states the model, and
`feat-formation-over-sereus-strand` is the work. Taleus's seating sits *inside* Sereus's formation
rather than duplicating it — `Stock.InvitationKey` **is** `Strand.Invite.Key`, one keypair at two
layers — the Taleus schema becomes `declare schema App { … }` beside `Strand` in one strand database,
and `TallyContract` is gated on the strand being sealed. Both mechanisms were verified against
Quereus rather than assumed: a sApp CHECK reads the `Strand` namespace, and `draft1.qsql` wraps with
no qualification changes.

**Identity is settled** too: `docs/identity.md`. A `Sid` is strand-local and anchored on the Sereus
`Member.Key`; `PartyKey` holds the keys that may sign as it. The two are *not* redundant, and the
reason is sharp — a sealed strand refuses `addMemberByManager`, so a party's Sereus membership key
can never be rotated for the life of a tally. Key rotation after a compromise is therefore Taleus's
job, and `PartyKeyAdoption` is the only recovery path.

**Atomic seating is settled**: Sereus's writers take `joinOpenTransaction` (default true), so
`consumeInvite` + `Foil` + genesis key commit as one act.

One question left, and it shapes the API:

1. **Which transactor backs a tally strand?** `docs/STATUS.md` records that it *must* be the
   synchronous Optimystic network transactor: the `quereus-sync` CRDT path writes column deltas
   straight to storage and **fires no SQL constraints at all**, which silently voids every
   signature gate in the schema. That choice lives in the Sereus adapter and is easy to get wrong
   by default.

Parked upstream: `feat-multi-use-tally-invitation` — Sereus offers closed **XOR** multi-use, and a
vendor's printed QR needs both.

### Step 3 — design the API surface

Criterion 1 of `SPEC.md`. Not by extrapolating from the row-builders in `src/tally/` — that is how
table names leak through the seam. Two requirements that are already known:

- **Async wherever anything can happen** (`SPEC.md` § 2). Sync only for pure computation over values
  in hand.
- **The error value must carry the engine's refusal reason**, not merely that something was refused.
  The row-level tests assert *which* constraint fired, and that has earned its keep twice: it caught
  a test passing on a SQL typo, and it caught `NotLastKey` being dead code. If the API flattens that
  into `{ kind: 'refused' }`, the suite gets weaker the moment it moves up.

### Step 4 — migrate the suite up, do not duplicate it

The dividing line is **not** "happy path versus refusal". Most refusals express fine through an API,
because the API must take keys and signers as parameters — a party holds several keys and chooses
which signs. The line is: **does the API compute the field under test?** If it does, the test has to
sit below it.

| Where | Roughly | Which |
|---|---|---|
| Stays below, always | ~27 | `src/store/*.test.ts` — host scalars, schema loading, determinism, spec rules, digest delegation. The core's internals; no API touches them |
| Moves up | ~36 | Most of `src/tally/*.test.ts`, refusals included. They improve: domain assertions instead of `select ... from AuthorizedKey` |
| Stays below | ~9 | Listed next. The reason a row-level layer exists at all |

The nine that stay are where the API computes the thing under attack, or the concept is row-shaped:

- `formation`: *refuses a genesis key that authorizes itself* (the API always signs genesis with the
  invitation key); *refuses a Cid that does not address its own founding fields* (the API computes
  the Cid); *cannot seat a party one row at a time* (documents why the API must be atomic)
- `keys`: *the fresh key must prove it is held* (forges a signature the API would never emit);
  *a batch that would empty the set* (batching is row-shaped); both `FINDING:` tests
- `negotiation`: the `FINDING:` counter-offer test (a PK collision on a second row)

These are not duplicates of anything. They answer *"what happens when a peer sends a row no honest
client would produce"* — which is why the schema validates rather than trusting the sender, and a
path an API test can never reach because the API **is** the honest path.

The two-replica harness (`src/store/test-harness.ts`) stays regardless: an API-level test still
wants "and the counterparty's engine accepted it too".

---

## Where tests live

- `src/**/*.test.ts` — co-located with the code, run by `yarn workspace taleus-core test`.
- `src/store/strand.ts` — opens the real `schema/*.qsql` in Quereus, in memory, with the host
  scalars registered. Everything below that touches persistence goes through it.

**Negotiation is always two parties.** `src/store/tally.ts` opens one replica per party, and an act
is *proposed* to both: each engine re-validates it against its own copy of the schema, and the row
stands only if both accept. That is the real safety model — the counterparty's engine is what stops a
forgery — and a test on one shared database would be testing a system nobody will run. A partial
acceptance raises `DisagreementError` rather than diverging silently.

Some things are honestly single-party: the host scalars, and a party's own key management before any
counterparty exists. Those open one replica.

What this does **not** model is Optimystic's ordering under concurrency — two replicas are applied in
sequence, not raced. Anything about two writers reaching the same row at once needs the real
transactor; marked *needs-transactor* below and tracked in `docs/STATUS.md` § Cross-repo.

Every `refuses(...)` assertion names the constraint it expects. A test that only asserts "something
failed" passes for the wrong reason sooner or later — one in this suite already did, failing on a
duplicate column in its own SQL while claiming to prove an authorization rule.

## Borrowed from MyCHIPs

`mc/mychips/test/auto` is the accumulated learning of the system this reboots — 5,543 lines. The
code does not transfer (PostgreSQL, `LISTEN`/`NOTIFY`, peer server processes, `json_core`), but the
**scenarios** are the expensive part and they do. Sources worth mining, in order of value:

| MyCHIPs file | Lines | What to take |
|---|---|---|
| `proto/tally.js` | 561 | The two-party signing dance, end to end |
| `proto/sch-tally.js` | 350 | What the schema must refuse |
| `proto/chit.js` | 377 | Chit exchange protocol |
| `proto/sch-chit.js` | 413 | Chit validity rules |
| `proto/chain.js` | 261 | Hash-chain integrity, gaps, repair |
| `unit/validtally.js` | 158 | Tally validation predicates |
| `unit/maketally.js` | 232 | Construction and signing |

---

## 0. Findings so far

Things the tests turned up that are design questions rather than test failures.

- **`Foil` is not a singleton.** `Stock` uses `primary key (/* 1 row */)`; `Foil` uses
  `primary key (Sid)`. A second responder is stopped only because they would be a third `Sid`
  (`TwoParties` on `PartyKey`). Sound today, indirect, and it reads as an oversight.
- **`DayNumber` and `Today()` are now separate scalars.** A gate calls `DayNumber(SomeColumn)` and is
  pure; a report calls `Today()` and is volatile. There is no spelling that lets a constraint read
  the clock by accident — which matters, because a CHECK that did would have replicas disagree.
- **The store's `Digest` delegates to `src/lift/digest.ts`.** The first draft carried a second
  encoding; that is precisely the divergence that file warns about, and it would have shown up as
  every signature failing to verify while looking like a permissions bug.
- **A `Sid` is not held to being anything — now with an answer.** Nothing enforces what a `Sid` is;
  a party may seat under any string. `docs/architecture.md` said it should be the hash of the
  genesis key, which assumed a portable identity. **That assumption is now reversed**
  (`docs/identity.md`): a `Sid` is **strand-local**, one person is deliberately not one identity,
  and the fix is to anchor it on the party's Sereus `Member.Key` — checkable, because a sApp CHECK
  can read the `Strand` namespace. Work is in `feat-formation-over-sereus-strand`.
- **`TallyContract` had never been insertable.** Four of its constraints referenced a bare
  `StockSid` / `FoilSid`, which exist only on `TallyCore` — `Column not found: StockSid` on the first
  insert. So the row that turns an offer into a tally could not be written at all. **Fixed**: spelled
  `(select StockSid from TallyCore)`, which is how every other table in the schema does the same
  lookup. Unambiguous repair of broken SQL, not a design change.
- **There is no counter-offer.** `TallyContractProposal` is `primary key (/* 1 row */)` with
  constraints `on insert, update` — one row, replaced in place. `docs/architecture.md` describes
  offers with identity, ordering and expiry, several outstanding at once, and the later-drafted one
  governing when two end up signed. None of that exists: a counter destroys the offer it answers,
  nothing expires, and no history survives. This is `feat-offer-lifecycle`, and it is the MyCHIPs
  signing dance the reboot left implicit. **Not fixed** — it is a design decision.
- **A host scalar used only inside a column CHECK is invisible until the first insert.**
  `ValidDenomination` was never registered and the schema-loads test passed regardless, because
  Quereus plans column CHECKs lazily. A test now reads the schema for every function it calls and
  asserts the host provides it.
- **Four columns documented "optional" are declared NOT NULL**: `CreditTerms.Args`,
  `Ledger.Reference`, `Ledger.Memo`, and `Invoice`'s pair. The schema's convention is an explicit
  `null` (six columns have it); these do not, so they cannot be omitted. The core passes empty text
  and the signature covers that — worth settling before anything signs in anger.
- **`Ledger.BalanceCorrect` did not chain — the most serious defect found so far.** It read
  `(select Balance from Ledger where Number = Number - 1)`; both `Number`s resolve to the subquery's
  own column, so the predicate was `Number = Number - 1` — never true. The lookup always returned
  nothing, `Coalesce` made it `0`, and **every chit's `Balance` had to equal its own delta**. The
  consequences compound: `PerspectiveBalance` reads the latest row's `Balance`, so it reported the
  last chit's amount rather than the tally balance; and `WithinCreditLimits` gates against that, so
  **the credit limit was per-chit, not cumulative — any limit could be exceeded by issuing enough
  small chits.** **Fixed**: `where L.Number = New.Number - 1`. The closing gate three constraints
  below already spelled it correctly, which is what makes this a typo rather than a design choice.
- **`Ledger.ValidIssuer` referenced a column that does not exist**, making the table uninsertable
  exactly as `TallyContract` was. The schema's own comment flagged it as a draft placeholder from
  when the ledger stored the issuer's Sid rather than an `'S'`/`'F'` side code, left for separate
  triage. It could never be evaluated, so it had no semantics to preserve, and the only validation
  it plausibly intended is already done by the column check `Issuer in ('S','F')` plus
  `SignerAuthorized`. **Removed** as dead code, with the reasoning left in its place.
- **A chit's digest names the issuer under an alias saying recipient.**
  `Ledger.SignatureValid` computes `case when Issuer = 'F' then FoilSid else StockSid end
  RecipientSid` — the foil's Sid for a foil-issued chit, which is the *issuer's*. Cryptographically
  harmless (both sides compute the same thing), but a trap for anyone writing a second
  implementation from the schema, which is precisely how signature divergence happens. **Recorded,
  not changed** — renaming it changes no bytes, but it should be renamed deliberately.
- **`PartyKeyRevocation.NotLastKey` never runs.** Every in-process route to an empty authorized set
  is closed earlier by `RevokerAuthorized`: the live `AuthorizedKey` view already excludes the
  in-flight revocation, so a key cannot revoke itself, and in a batch the first revocation excludes
  the second's signer. The case `NotLastKey` was written for — two *concurrent* transactions, A
  revoking B while B revokes A, colliding on no primary key — is one this harness structurally
  cannot reach. **The last-key guarantee therefore rests entirely on Optimystic re-evaluating the
  deferred CHECK against the latest committed snapshot**, which `docs/STATUS.md` § Cross-repo lists
  as unconfirmed. A test records this so it is not mistaken for covered.

## 1. Substrate

- [x] Every statement in `draft1.qsql` executes in Quereus
- [x] Every statement in `portfolio.qsql` executes
- [x] No constraint or default reads a clock or a random source
- [x] Host scalars agree with the schema's expectations: `DayNumber` ordering and UTC reading,
      `ValidDate` rejects non-dates, `Digest` is injective across argument boundaries and across
      types, `SignatureValid` round-trips a real key pair and refuses the wrong key or content
- [x] `Digest` here and `src/lift/digest.ts` produce identical bytes — the store scalar *delegates*
      to the lift module's canonical encoding rather than carrying a second one *(the first draft
      did carry a second one; the test caught it)*

## 2. Identity and keys

- [x] An authorized key admits another, and the **counterparty's** engine accepts it unprompted —
      which is what makes a revocation containable without the counterparty noticing
- [x] A key cannot admit itself (`AuthKeyAuthorized`, read against the committed snapshot)
- [x] Authority does not cross the party boundary: the counterparty's key cannot admit one
- [x] `Revision` is contiguous — a gap fails `RevisionMonotonicInt`, a reuse collides on the PK
- [x] The same key cannot be registered twice (`UniqueKey`)
- [x] A surviving device retires a lost one; both engines stop accepting it
- [x] A revoked key cannot authorize, cannot revoke, and can never be re-added
- [x] A key cannot revoke itself, so the last key survives — by `RevokerAuthorized`, **not** by
      `NotLastKey`; see § 0
- [x] Counterparty adoption: two signatures over one digest — possession by the recovering party,
      attestation by the counterparty. Neither alone is enough
- [x] An adopted key can authorize fresh device keys, so recovery does not stop one step short
- [x] A party cannot attest for itself (`CounterpartyIsOther`); an adopted key is revocable like
      any other
- [ ] *needs-transactor* — concurrent double-revocation: exactly one commits, the party keeps a key
- [ ] A `Sid` is the hash of its genesis key *(claimed by the docs, unenforced — see § 0)*

## 3. Formation

- [x] Seating is **atomic and circular**: `Stock.SignerAuthorized` needs the inviter's `PartyKey`,
      and the genesis `PartyKey` signature validates against `Stock.InvitationKey`. Neither row goes
      in alone; only a transaction whose subquery CHECKs defer to COMMIT seats anybody
- [x] Stock side: `Stock` + genesis key, signed by an authorized key of the inviter
- [x] Foil side: the `Foil` row is signed with the **invitation secret** — the only thing tying the
      responder to this strand. A responder without it is refused (`InvitationSignatureValid`)
- [x] A genesis key cannot authorize its own admission (`SignatureValid` against the invitation key)
- [x] A second responder is refused — though by `TwoParties` on `PartyKey`, **not** by any rule on
      `Foil`, whose primary key is `(Sid)` rather than the singleton `Stock` uses. The protection is
      real but indirect; worth Nate's eye
- [x] A third party is never admitted (`TwoParties`)
- [x] `TallyCore` cannot be named before the invitee seats (`FoilSeated`)
- [x] `TallyCore.Cid` must address its own founding fields (`CidCorrect`), and both parties compute
      the same identity from them
- [x] The **initiator** names the tally; the invitee signing it is refused (`SignerAuthorized`)
- [ ] Both `Stock` and `Foil` are insert-only: no update, no delete
- [ ] The denomination is fixed at formation and never changes
- [ ] A certificate discloses only what its party chose *(story 11; `feat-disclosure-selection`)*

## 4. Negotiation

- [x] A proposal is signed by the side it claims to come from; the other side's key is refused
- [x] An offer carries **both** parties' terms revisions, so it is a complete proposition
- [x] Countersigning makes a tally: one `TallyContract` row carrying both signatures over one digest
- [x] One signature is not a tally — the same party signing both halves is refused
- [x] A contract cannot lock terms revisions that were never published
- [x] A key revoked before countersigning cannot complete the contract — authority is checked when
      the row is written, not when the key was issued
- [x] The denomination accepts `CHIP`, `iso4217:AAA` and `cid:<address>`, shape only, and refuses
      `iso4217:usd`, `iso4217:US`, `iso4217:USDX`, `cid:` and bare words
- [x] **FINDING** — there is no counter-offer, no offer history and no expiry; see § 0
- [ ] Two proposals fully signed at once: the later-drafted one governs *(unreachable — one proposal
      row exists; `feat-offer-lifecycle`)*
- [ ] An expired proposal cannot be countersigned *(nothing expires)*
- [ ] A refusal is visible to the offeror *(open: `feat-offer-lifecycle`)*
- [ ] Derived state reads `Forming` before any contract, `Open` after *(blocked on
      `feat-schema-tally-state`)*
- [ ] Renegotiation: a later countersigned proposal becomes a new `TallyContract` revision

## 5. Credit terms

- [x] A grantor's terms are unilateral — grantor-signed, and the counterparty's engine accepts them
      without having agreed to anything
- [x] A party cannot publish terms in the other's name (`SignerAuthorized`)
- [x] A stranger to the tally cannot publish terms at all (`PartyOfTally`)
- [x] A permissive change (limit up, notice unchanged) takes effect at once
- [x] A restrictive change must wait out the notice period *already agreed* — one day short is
      refused
- [x] Shortening the notice period is itself restrictive, so it waits like any reduction
- [ ] Absent any `CreditTerms` row the effective limit is zero, so the first nonzero chit fails
- [ ] A future-dated restrictive revision and a later immediate permissive one coexist correctly

## 6. Direct chits

- [x] A chit is signed by the party it makes worse off, and needs no countersignature — one
      signature moves the tally
- [x] The other party cannot sign it (`SignerAuthorized`) — Jan cannot put Sam into debt
- [x] A signature over different content is refused (`SignatureValid`) — the shape of a chit
      tampered with in flight
- [x] `Units` must be positive; direction comes from `Issuer`, not the sign of the amount
- [x] `Balance` chains: it accumulates, both parties read the same running total, and a balance
      equal to the chit's own delta is refused
- [x] Wrong arithmetic is refused in either direction
- [x] The credit gate admits a chit inside the grantor's effective limit and refuses one past it
- [x] The gate is **cumulative, not per chit** — the consequence of the chain bug above
- [x] Each side binds separately: a party that granted nothing may be owed nothing
- [x] With no terms published, nothing may be owed
- [x] `DateMonotonic`: a chit dated before its predecessor is refused; the same day is fine
      *(`docs/timestamps.md`)*
- [x] The date selects the credit epoch — a chit dated before a restrictive cut takes effect gets
      the old limit, one dated after gets the new one
- [x] A chit's `Id` is inside its signed digest, so it cannot be assigned by the store
- [x] **FINDING** — the digest names the issuer under an alias saying recipient; see § 0
- [x] Every act is validated independently by both parties' engines *(the harness does this for
      every test; `DisagreementError` is raised where they differ)*
- [ ] *needs-transactor* — the same chit reaching both replicas concurrently

## 7. Invoices

- [ ] An invoice is signed by the party asking to be paid
- [ ] It is answered by exactly one chit, from the opposite side, for the exact units
- [ ] Partial payment is refused; an unlinked chit of a different amount leaves it open
- [ ] A decline is recorded and visible
- [ ] State precedence is `paid > declined > expired > open`
- [ ] A late payment of an expired invoice succeeds and reads as `paid`
- [ ] An invoice may exceed current capacity; only the answering chit is credit-gated

## 8. Close

- [ ] Either party may file a `CloseRequest` at any time, without the other agreeing
- [ ] While closing, a chit that moves the balance toward zero is admitted
- [ ] While closing, a chit that moves it away from zero is refused
- [ ] `CloseState` reads `closing` with a request filed, `closed` once settled with nothing pending
- [ ] A settled close is terminal *(`debt-tally-close-no-reopen`)*

## 9. Reading

- [ ] `PerspectiveBalance` states the same figure oppositely to each party
- [ ] `CurrentCreditLimit` returns the terms in force, not the latest filed
- [ ] `ReservedBalance` includes open pledges; `PerspectiveBalance` does not
- [ ] Reading a tally with no activity returns a coherent zero, not an error

## 10. Stubs — not built, asserted absent

- [ ] Lift pledge/finalize/void constraints exist in the schema and are exercised only by
      `src/lift/*` against doubles; re-grounding them on a real strand is deferred
- [ ] Network discovery, routes and referees: `src/lift/` covers the protocol in process; nothing
      here opens a socket
