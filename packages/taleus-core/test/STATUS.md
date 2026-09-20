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

A single store cannot model two parties disagreeing. Anything about replication or concurrent
writers opens **two** strands and moves rows between them by hand; those are marked *two-strand*.

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

## 1. Substrate

- [x] Every statement in `draft1.qsql` executes in Quereus
- [x] Every statement in `portfolio.qsql` executes
- [x] No constraint or default reads a clock or a random source
- [ ] Host scalars agree with the schema's expectations: `DayNumber` ordering, `ValidDate` rejects
      non-dates, `Digest` is injective across argument boundaries, `SignatureValid` round-trips a
      real key pair
- [ ] `Digest` here and `src/lift/digest.ts` produce identical bytes for the same input *(a
      divergence makes every signature fail to verify, and it looks like a permissions bug)*

## 2. Identity and keys

- [ ] Genesis: `Sid` is the hash of the Revision-1 public key
- [ ] An authorized key can add another; an unauthorized one cannot
- [ ] `Revision` is monotonic per `Sid`; a gap or reuse is refused
- [ ] A revoked key cannot be re-added (the insert-only row makes the count 2)
- [ ] A revoked key cannot authorize, sign, or revoke
- [ ] The last remaining key cannot be revoked
- [ ] *two-strand* — concurrent double-revocation: exactly one commits, the party keeps a key
- [ ] Counterparty adoption lets a recovered party authorize fresh device keys

## 3. Formation

- [ ] Stock side: a single `Stock` row, signed by an authorized key of the inviter
- [ ] Foil side: `Foil` insert requires a signature by the out-of-band invitation key
- [ ] A `Foil` for a party with no `PartyKey` is refused
- [ ] Both `Stock` and `Foil` are insert-only: no update, no delete
- [ ] A second `Foil` on the same strand is refused (one responder per invitation)
- [ ] `TallyCore` binds the two `Sid`s and the denomination; the denomination never changes
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
- [ ] *two-strand* — the same chit inserted on both sides validates identically

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
