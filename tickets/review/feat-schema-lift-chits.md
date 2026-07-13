description: Added conditional lift entries to the tally ledger — pledges that reserve credit while a lift is pending and only become final when the lift's chosen referee signs off, so value-clearing across many tallies commits all-or-nothing.
files: schema/draft1.qsql, docs/architecture.md
----

# Review handoff: lift chits (pending / finalized / voided)

Implements `feat-schema-lift-chits`. Treat the tests below as a **floor**, not a finish line —
and read the **Validation status** section first: the schema does not currently parse on the
real engine for a *pre-existing* reason, so none of this has been machine-checked. Every claim
here is by-inspection against sibling constraint patterns.

## What shipped (all in `schema/draft1.qsql`)

- **`PendingLift` table** — conditional, issuer-signed lift pledge, PK `LiftId` (one pledge per
  lift per tally). Columns: `RefereeKey`, `Issuer('S'/'F')`, `Units>0`, `Date`, `Expiry`,
  `SignerKey`, `Signature`. Constraints: `SignerAuthorized` (issuer's authorized key),
  `SignatureValid` (issuer signs `Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry)`),
  `ExpiryValid` (`Expiry >= Date`), `WithinReservedCredit` (reserved-balance gate), `InsertOnly`.
- **`LiftVoid` table** — referee-signed void, PK `LiftId`. Constraints: `PendingExists`,
  `NotFinalized` (no settled lift row), `RefereeVoidValid` (referee signs the **distinct** digest
  `Digest(Cid, LiftId, 'void')`), `InsertOnly`.
- **`Ledger` changes** — new `Kind('direct'/'lift') default 'direct'`, `LiftId`,
  `RefereeSignature`. `SignerAuthorized`/`SignatureValid`/`ValidIssuer`/`InvoiceLink` guarded
  `Kind='direct'`-only; `WithinCreditLimits` exempts `Kind='lift'`; **new** `WithinReservedCredit`
  (direct-only reserved gate) and `LiftFinalize` (lift-only: matching pledge + Issuer/Units/Date
  equal + referee commit signature valid + not voided + no prior finalize) and
  `KindColumnsConsistent` (null-hygiene per Kind). `BalanceCorrect`/`InsertOnly` unchanged. The two
  `-- TODO: lift ...` comments are deleted; the stale `WithinCreditLimits` "in Balance by
  construction" comment is corrected.
- **Views** — `OpenPendingLift` (unresolved pledges), `ReservedBalance` (settled + open pending,
  single row), `ReservedPerspectiveBalance` (per party); `LiftLading` repointed to
  `ReservedPerspectiveBalance`; `PerspectiveBalance` left **settled** and its TODO resolved.
- **Docs** — `docs/architecture.md`: `Ledger` row rewritten + `PendingLift`/`LiftVoid` rows added;
  views paragraph, "Ledger Operation" credit-gate + lift-chit bullets, and "Lifts and ChipNet"
  mapping bullets all updated for settled-vs-reserved and referee resolution.
- **Backlog** — `backlog/feat-lift-timeout-release` already existed (plan stage); left as-is (it
  accurately captures the referee-unreachable liveness gap).

## Core model to keep straight while reviewing

- **Settled balance** = `Ledger.Balance` chain (direct chits + finalized lifts). Authoritative;
  `PerspectiveBalance` reports it.
- **Reserved balance** = settled + every *open* pending-lift delta. Gates new pledges + new direct
  chits; `LiftLading` advertises from it. `ReservedBalance` is stock-perspective, same
  `Issuer='F' ? +1 : -1` sign as `BalanceCorrect`.
- **Finalize is two inserts, never a mutation.** The `PendingLift` row stays; the finalize is a new
  `Ledger` `Kind='lift'` row; `OpenPendingLift` excludes it once the finalize lands, so its delta
  moves from reserved→settled and the reserved total is unchanged.

## Validation status — READ THIS (honest gap)

**The schema does not parse on quereus, for a pre-existing reason, so my additions were never
machine-validated.** I ran quereus's own parser (`../quereus`, `parseAll` from source) against
`draft1.qsql`; it fails at **line 8** (`Stock`, untouched by this ticket):

```
Expected CONFLICT after ON. Got 'insert'.  (line 8)
```

The whole schema uses the trailing constraint-trigger form `check (expr) on insert`; quereus
accepts only the **leading** form `check on insert (expr)` (confirmed against its fixtures
`40.2-check-extras.sqllogic` / `43.2-deferred-check-new-on-delete.sqllogic`, and by isolated parse
of both forms). This is schema-wide and predates this ticket — the prior sibling schema tickets
shipped without ever actually running a parse. **Recorded in `tickets/.pre-existing-error.md`** for
the runner's triage pass; not fixed here (it is a repo-wide mechanical rewrite, or an upstream
dialect question — not this ticket's to smear across).

Consequence for review: my new constraints deliberately follow the existing **trailing** form for
file consistency, so they share the same parse blocker and I could not get a clean parse of my own
SQL. **Everything below is by-inspection only.** Once the pre-existing syntax issue is resolved, a
real parse + behavioral run of the cases below is the actual validation and should be treated as
outstanding.

## Test / validation use cases (the floor)

Balance & reservation:
- Insert pending → assert `ReservedBalance` reflects the delta and `Ledger.Balance` does **not** →
  finalize → assert `Ledger.Balance` moved and `ReservedBalance` unchanged (pledge no longer open,
  delta now settled).
- Void a pending → assert reservation released (`OpenPendingLift` drops it, `ReservedBalance` back to
  settled).
- Mixed signs: one stock-issued pending (−delta) + one foil-issued pending (+delta) open at once →
  `ReservedBalance` nets correctly.

Mutual exclusion (both directions):
- finalize after void → rejected (`LiftFinalize.NotVoided`); void after finalize → rejected
  (`LiftVoid.NotFinalized`); double-void → rejected (PK); second finalize of same `LiftId` →
  rejected (the `count(*)=1` clause in `LiftFinalize`, since `Ledger` PK is `Number`, not `LiftId`).

Signature / replay:
- Referee commit signed over a different `Cid`, `LiftId`, or altered `Units`/`Date` → finalize
  rejected (digest binds all of them).
- A void signature presented as a commit and vice-versa → rejected (distinct digests).
- Finalize naming a **non-existent** `LiftId` → rejected by `LiftFinalize`'s leading `exists` guard
  (without it a Quereus CHECK passes on NULL — the load-bearing case; mirror of
  `DenominationImmutable`). Void with no pledge → rejected by `PendingExists`.

Credit gates:
- Reserved gate: two pledges each individually within limit but jointly over → the second rejected
  by `WithinReservedCredit` (subject to the isolation caveat below under concurrency).
- Direct chit blocked when an open pledge already reserves the room (`WithinReservedCredit` on
  `Ledger`).
- **Finalize never credit-blocked:** set limits so the post-finalize settled balance exceeds them;
  finalize must still succeed (`Kind='lift'` exempt from both gates). Contrast a direct chit /
  pledge that would exceed → rejected.

Null-hygiene:
- `Kind='direct'` with a non-null `LiftId`/`RefereeSignature`, or null `SignerKey`/`Signature` →
  rejected; `Kind='lift'` with a non-null `SignerKey`/`Signature`/`InvoiceId`, or null
  `LiftId`/`RefereeSignature` → rejected; `Kind` explicitly NULL → rejected (both arms FALSE).

## Tripwires (parked in-code; this is the index, not the analysis)

- **Commit-time isolation** — `NOTE` at `Ledger.LiftFinalize` / `LiftVoid` and appended to the
  `InvoiceLink` note: the finalize/void mutual-exclusion, single-finalize, and reserved-gate CHECKs
  are commit-time deferred and only hold if Optimystic re-evaluates against the latest committed
  snapshot. Rides the **same** open question as `PartyKeyRevocation.NotLastKey` (`:137-146`) and
  `InvoiceLink`; not re-solved. Lift resolution was added to that cross-reference list.
- **View-inside-CHECK** — `WithinReservedCredit` (on both `PendingLift` and `Ledger`) reads
  `(select Balance from ReservedBalance)`, a view, inside a CHECK. Same untested-in-quereus class
  already flagged for `AuthorizedKey`-in-CHECK (`:237-243`). Confirm when the parser issue clears.
- **ChipNet digest field-order contract** — `NOTE` at `PendingLift.SignatureValid`: the lift-terms
  digest order `Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry` MUST match what the ChipNet
  referee signs. Cross-component; `feat-chipnet-integration` must not drift from it.
- **Volatile-in-view** — unchanged from before but note `ReservedBalance` itself is non-volatile
  (no `now()`), so it is materializable; only the pre-existing `julianday('now')` views carry that
  caveat.

## Findings for triage (not tripwires)

- **Pre-existing parse blocker** (see Validation status) — recorded in
  `tickets/.pre-existing-error.md`. Blocks *all* schema validation, not just this ticket. Highest
  priority for the triage pass.
- **`Ledger.ValidIssuer` references a non-existent `IssuerSid` column** (should be `Issuer`) — a
  pre-existing draft placeholder, left untouched with a one-line `NOTE` at the site per the ticket.
  Unrelated to lifts; flag for separate triage (it will also fail once the schema actually binds).

## Explicitly out of scope

- Party-driven release of a reservation stuck behind an unreachable referee — `backlog/feat-lift-timeout-release`.
- Solving the Optimystic isolation model — shared open question, not this ticket.
- Fixing the schema-wide constraint-trigger syntax or `ValidIssuer` — pre-existing, routed to triage.
