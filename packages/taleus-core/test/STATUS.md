# taleus-core — test inventory

Every test we can currently conceive for the core, whether written or not. This file is the
checklist the build works down; it is **not timeless** — a line goes away when it is covered and the
coverage is obvious from the suite itself.

Scope for now: **tally negotiation, tally management, and direct payments.** Network queries and
lifts are stubs; the lift module already has its own in-process suite (`src/lift/*.test.ts`) against
test doubles, and re-grounding that on the real schema comes after direct chits work.

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
- **A `Sid` is not held to being a content address.** `docs/architecture.md` says it *is* "the hash
  of the genesis (Revision 1) public key", and `PartyKey.Sid`'s own comment repeats it. Nothing
  enforces it — a party may seat under any string. Contained within a strand, because every
  signature is checked against keys registered *on that strand*; what it costs is the Sid's
  portability, which is the entire point of a content address. Fixing it means pinning the Sid's
  encoding system-wide, so it is Nate's call rather than a test's.
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

- [ ] A chit is signed by the party it makes worse off, and needs no countersignature
- [ ] `Units` must be positive; direction comes from `Issuer`, not the sign of the amount
- [ ] `Balance` chains contiguously off the prior row; a gap or wrong total is refused
- [ ] An unsigned chit, a chit signed by an unauthorized key, or one signed over different content
      is refused
- [ ] The credit gate admits a chit inside the grantor's effective limit and refuses one outside it
- [ ] The gate reads the limit effective **as of the chit's own date**
- [ ] `DateMonotonic`: a chit dated before its predecessor is refused *(`docs/timestamps.md`)*
- [ ] Backdating past a restrictive reduction is bounded by the previous chit's date
- [ ] A chit's `Id` is inside its signed digest, so it cannot be assigned by the store
- [ ] The zero-credit default: the very first chit on a tally with no terms is refused
- [x] Every act is validated independently by both parties' engines *(the harness does this for
      every test; `DisagreementError` is raised where they differ)*

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
