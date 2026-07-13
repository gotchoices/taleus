----
description: Added conditional lift entries to the tally ledger — pledges that reserve credit while a lift is pending and only become final when the lift's chosen referee signs off, so value-clearing across many tallies commits all-or-nothing.
files: schema/draft1.qsql, docs/architecture.md
----

# Complete: lift chits (pending / finalized / voided)

Implements `feat-schema-lift-chits`. Adds conditional lift pledges to the tally schema:
a `PendingLift` pledge reserves credit while a lift is in flight and settles into the
`Ledger` (as a `Kind = 'lift'` chit) only when the chosen referee's commit signature
arrives, or is cancelled by a referee-signed `LiftVoid`. Because every tally strand on a
lift route independently verifies the *same* referee signature, the whole route commits or
cancels atomically with no cross-strand transaction.

See the implement commit `caab134` for the full change; this file records the review.

## What shipped (recap)

All in `schema/draft1.qsql` + `docs/architecture.md`:

- **`PendingLift`** — conditional, issuer-signed pledge, PK `LiftId`. Reserves capacity via the
  reserved-balance views; does not move the settled `Ledger.Balance`.
- **`LiftVoid`** — referee-signed cancel, PK `LiftId`, distinct void digest.
- **`Ledger`** — new `Kind`/`LiftId`/`RefereeSignature`; direct-vs-lift split across
  `SignerAuthorized` / `SignatureValid` / `ValidIssuer` / `InvoiceLink` (direct-only), the two
  credit gates (lift-exempt), and new `WithinReservedCredit`, `LiftFinalize`,
  `KindColumnsConsistent`.
- **Views** — `OpenPendingLift`, `ReservedBalance`, `ReservedPerspectiveBalance`; `LiftLading`
  repointed to the reserved balance; `PerspectiveBalance` left settled.
- **Docs** — `Ledger`/`PendingLift`/`LiftVoid` rows, views paragraph, Ledger-Operation credit
  gates + lift-chit bullets, and Lifts-and-ChipNet mapping all updated.

## Review findings

Reviewed the implement diff (`caab134`) with fresh eyes against the current tree, then the
handoff. Scrutinized for correctness, DRY, sign consistency, double-counting, null-hygiene,
replay resistance, and doc drift. **The central caveat in the implement handoff — "schema does
not parse, nothing machine-validated" — is now stale**: the runner's triage pass (`3267bb4`)
rewrote the whole schema from the trailing constraint-trigger form `check (expr) on insert` to
the leading form `check on insert (expr)` that Quereus accepts, resolving the pre-existing parse
blocker. So this review was able to machine-validate, which the implementer could not.

**Machine validation (new this pass).** Ran Quereus's own parser + schema loader (from
`../quereus` source via `tsx`) against `schema/draft1.qsql`:

- **Parse: OK** — 27 statements (26 real + 1 injected `TallyCore` stub). The syntax blocker is
  gone.
- **Bind: 26/27 statements bind cleanly**, including *every* lift table and view —
  `Ledger` (with all new constraints), `PendingLift`, `LiftVoid`, `OpenPendingLift`,
  `ReservedBalance`, `ReservedPerspectiveBalance`. To reach binding I injected a stub `TallyCore`
  (pre-existing-missing, see below) and registered stub scalar functions for the app crypto
  primitives (`Digest`, `SignatureValid`, `ValidDate`, `ValidDenomination`, `RandomUUID`) plus a
  deterministic `julianday` (the built-in is flagged non-deterministic, which trips a pre-existing
  `CreditTerms.EffectiveDateValid` CHECK). Views were reordered tables-first for the load, because
  the file defines views before the tables they read — see *Checked / conditional* below.
- **The single bind failure is `LiftLading`** — `Function not found: max/2`. Pre-existing and
  unrelated to lift chits (below).

**Reservation arithmetic (by inspection, traced).** Confirmed the core invariant the ticket
rests on:
- Insert pending (`Issuer='F'`, +Units): `ReservedBalance` rises by the delta, settled
  `PerspectiveBalance` unchanged. ✓
- Finalize (new `Kind='lift'` Ledger row): `OpenPendingLift` drops the pledge (a `Kind='lift'`
  row now exists for its `LiftId`), so its delta moves reserved→settled and `ReservedBalance` is
  **unchanged** — no double-count. ✓
- Void: pledge drops from `OpenPendingLift`, no settled row, reservation released. ✓
- Mixed signs (`'F'` +delta and `'S'` −delta open at once) net correctly; `OpenPendingLift` and
  `BalanceCorrect` share the `Issuer='F' ? +1 : −1` convention. ✓

**Mutual exclusion / replay (by inspection).** `LiftFinalize.NotVoided` + `LiftVoid.NotFinalized`
enforce finalize/void exclusion both ways; double-void collides on PK; second finalize rejected
by the `count(*)=1` self-clause (Ledger PK is `Number`, not `LiftId`). The commit digest
(`Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry`) and the void digest (`Cid, LiftId,
'void'`) are distinct, so neither signature replays as the other, and binding `Cid`+`LiftId`
blocks cross-tally/cross-lift replay. The leading `exists`/`in` guards on `LiftFinalize` and
`LiftVoid.PendingExists` correctly force a definite FALSE (not a NULL-pass) for a
non-existent `LiftId` — mirrors the established `DenominationImmutable` pattern.

**Null-hygiene.** `KindColumnsConsistent` is a disjunction so a NULL `Kind` makes both arms FALSE
→ reject; per-Kind column presence is enforced. A lift row with NULL `Issuer`/`Units`/`Date`
slips past `LiftFinalize`'s equality terms as NULL, but is then caught by the referee signature
(the digest binds those fields, so a NULL-valued digest cannot verify) — defense-in-depth, not a
hole. Left as-is.

**Docs.** Read both changed files end-to-end. `docs/architecture.md` accurately reflects the
settled-vs-reserved split, the two credit gates and the lift exemption, and the referee
commit/void resolution. No drift found.

### Findings and disposition

- **Minor (fixed inline):** none needed in the lift-chit code itself — it binds and the logic is
  sound by inspection.
- **Major (new ticket filed):** `LiftLading` uses scalar 2-arg `min()`/`max()`, which Quereus
  does not provide (aggregate only) → the view fails to bind (`Function not found: max/2`).
  **Pre-existing** (present at `caab134~1`; the lift ticket only repointed the view's join), so
  not fixed inline per the pre-existing-work rule. Filed
  `backlog/debt-schema-liftlading-scalar-minmax` (rewrite as `case`, or add scalar min/max
  upstream — a Quereus-dialect decision); a signpost `NOTE:` sits at the `LiftLading` definition.
- **Pre-existing, already tracked (no new ticket):**
  - `TallyCore` is referenced everywhere but never defined — `backlog/debt-schema-tallycore-table`
    / `backlog/debt-schema-core-tables`. This (plus the view-before-table ordering) is why
    data-level behavioral testing of the lift flow could not run; it is blocked on those tickets,
    not on anything in this diff.
  - `Ledger.ValidIssuer` references a non-existent `IssuerSid` column (should be `Issuer`) — a
    draft placeholder, left untouched with a `NOTE:` at the site per the ticket. CHECK bodies bind
    lazily in Quereus, so this trips only on a direct-chit insert, not at `CREATE TABLE`; still a
    latent defect for whenever the schema is exercised. Flagged for separate triage in the
    implement handoff; unrelated to lifts.
  - `CreditTerms.EffectiveDateValid` (and other `julianday`-in-CHECK sites) trip Quereus's
    non-determinism guard on the built-in `julianday`. Pre-existing; noted here as context for the
    validation harness, not this ticket's to fix.
- **Conditional / speculative → tripwires (parked in-code, not ticketed):** unchanged from the
  implement handoff and re-confirmed appropriate — commit-time isolation (rides the same open
  Optimystic-snapshot question as `PartyKeyRevocation.NotLastKey` / `InvoiceLink`), view-inside-CHECK
  (`WithinReservedCredit` reads the `ReservedBalance` view), and the ChipNet digest field-order
  contract. All carry `NOTE:` comments at their sites.

### Outstanding (for whoever picks up schema execution)

Data-level behavioral testing of the lift lifecycle (insert pending → assert reserved vs settled
→ finalize → void → mutual-exclusion → signature/replay → credit gates) — the "floor" cases in
the implement handoff — remains **outstanding**. It is blocked not by the lift code (which binds)
but by the pre-existing missing core tables (`backlog/debt-schema-core-tables`,
`backlog/debt-schema-tallycore-table`) and the key-authorization bootstrap needed to satisfy the
signature-gated inserts. Once those land, run those cases as the real behavioral validation.

## Out of scope (unchanged)

- Party-driven release of a reservation stuck behind an unreachable referee —
  `backlog/feat-lift-timeout-release`.
- The Optimystic commit-time isolation model — shared open question, parked as tripwires.
- Schema-wide constraint-trigger syntax — already resolved by triage (`3267bb4`).
- `ValidIssuer` `IssuerSid` fix and `LiftLading` scalar min/max — pre-existing, routed to triage /
  `backlog/debt-schema-liftlading-scalar-minmax`.
