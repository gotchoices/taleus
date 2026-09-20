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

- [ ] Genesis: `Sid` is the hash of the Revision-1 public key
- [ ] An authorized key can add another; an unauthorized one cannot
- [ ] `Revision` is monotonic per `Sid`; a gap or reuse is refused
- [ ] A revoked key cannot be re-added (the insert-only row makes the count 2)
- [ ] A revoked key cannot authorize, sign, or revoke
- [ ] The last remaining key cannot be revoked
- [ ] *needs-transactor* — concurrent double-revocation: exactly one commits, the party keeps a key
- [ ] Counterparty adoption lets a recovered party authorize fresh device keys

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

- [ ] A proposal is signed by its proposer and carries its own identity and ordering
- [ ] Either party may counter; each proposal is a new row, not a mutation
- [ ] Countersigning any unexpired outstanding proposal opens the tally
- [ ] Two proposals fully signed at once: the later-drafted one governs, and **both parties compute
      the same winner without a clock**
- [ ] An expired proposal cannot be countersigned
- [ ] A refusal is visible to the offeror *(open: `feat-offer-lifecycle`)*
- [ ] Derived state reads `Forming` before any contract, `Open` after *(blocked on
      `feat-schema-tally-state`: the reboot materializes only Closing/Closed, and this is the first
      thing the MyCHIPs tests will ask for)*
- [ ] Renegotiation: a later countersigned proposal becomes a new `TallyContract` revision

## 5. Credit terms

- [ ] A grantor's terms are unilateral — grantor-signed, no countersignature
- [ ] Revision 1 takes effect on its own date
- [ ] A permissive change (limit up, notice up) takes effect immediately
- [ ] A restrictive change may not take effect sooner than the *prior* notice period
- [ ] Absent any `CreditTerms` row the effective limit is zero, so the first nonzero chit fails
- [ ] A future-dated restrictive revision and a later immediate permissive one coexist correctly:
      the permissive one has the higher revision and supersedes

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
