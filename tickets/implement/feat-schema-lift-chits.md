description: Add conditional lift entries to the tally ledger — chits that only become final when the lift's chosen referee signs off — so value-clearing lifts across many tallies either all commit or all cancel.
files: schema/draft1.qsql, docs/architecture.md
difficulty: hard
----

# Lift chits: pending / finalized / voided

Realizes the two `Ledger` TODOs (`schema/draft1.qsql:654` "lift vs manual", "pending lift") and the
architecture's lift-chit mapping (`docs/architecture.md` "Ledger Operation" bullet 4, "Lifts and ChipNet").

## Background (read first)

A **lift** clears credit around a cycle (or along a chain) in the tally graph: every participant pays one
neighbor and is paid by another, net zero, but balances move back toward each party's target. Each tally on
the route is one **edge**; value flows one direction across it. The lift is coordinated by ChipNet with a
single agreed **referee** whose commit signature is the atomic-commit trigger for the whole route.

The problem this ticket solves: a lift touches many independent tally strands, but there is **no cross-strand
transaction**. Atomicity ("all edges commit or none") is achieved instead by every strand independently
verifying the *same* referee signature. So each edge must record a **conditional** pledge that reserves
capacity but does not yet move the signed balance, and then settle it only when (and if) the referee commits.

### Design decisions already made (do not re-open)

These are settled. Where a decision has a residual risk, it is recorded as a `NOTE:` to carry into the code.

1. **Companion table for the pending pledge, not a mutable Ledger row.** `Ledger` is insert-only and its
   `Balance` chain must contain *only settled value*. A pending lift pledge therefore lives in its own
   `PendingLift` table and never enters the `Ledger.Balance` chain. Finalization is a *fresh* `Ledger` insert
   (kind `lift`); voiding is a fresh `LiftVoid` insert. This is the "pending row + resolution row" pattern the
   plan asked for, and it leaves `BalanceCorrect` completely unchanged (it keeps chaining contiguous Ledger
   rows, all of which carry a real balance delta).

2. **The referee is the sole arbiter of resolution.** The referee signs *either* a commit *or* a void over
   the lift terms, and that single signature resolves every strand the same way — this is exactly what gives
   cross-strand atomicity with no cross-strand transaction. Parties do **not** unilaterally void. "Timeout" is
   simply the referee choosing to sign a void after the pledge's expiry; it is the *same* `LiftVoid`
   mechanism, not a separate party-driven path.
   - **NOTE (liveness gap):** if the chosen referee becomes permanently unreachable, an open `PendingLift`
     reserves capacity forever (no party can void it alone without breaking atomicity). This is inherent to a
     referee-arbitrated, no-cross-strand-transaction model and matches ChipNet's actual trust model
     (referee reliability is the mitigation). A bilateral / bounded party-driven release ceremony is parked
     in `backlog/feat-lift-timeout-release` — do **not** build a unilateral party void here; it would let one
     edge void while the referee-committed others finalize, breaking atomicity.

3. **A referee-committed finalize is NEVER blocked by a credit gate.** Credit limits are enforced at the
   points where *new* capacity is committed — direct chits and `PendingLift` pledges (the reserved-capacity
   gate). Once the referee has committed, the finalize `Ledger` row must always succeed, or a credit check on
   one strand could reject a finalize the other strands accept — breaking atomicity. So `Kind = 'lift'` rows
   are **exempt** from both credit gates. The pledge was already reserved-gated at insert; the referee commit
   is authoritative.
   - **NOTE (soft limit):** because the reserved gate is best-effort under concurrency (see the isolation
     caveat below), a finalized lift *can* push the settled `Balance` past the nominal credit limit. That is
     accepted and correct — a committed lift is binding. The credit limit gates voluntary new credit, not the
     settlement of an already-pledged, referee-committed lift.

4. **Digest binds tally `Cid` + `LiftId` + terms.** Both the issuer's pledge signature and the referee's
   commit signature are over `Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry)`. Binding this
   tally's `Cid` and the `LiftId` makes a commit signature from another tally or another lift impossible to
   replay here. The void digest is *distinct* — `Digest(Cid, LiftId, 'void')` — so a commit signature can
   never be replayed as a void or vice versa. The schema realizes the plan's `verify()` with the existing
   host scalar `SignatureValid(digest, sig, key)`, checking the referee signature against the `RefereeKey`
   named in the `PendingLift` row.
   - **NOTE (protocol contract):** the exact field order of the lift-terms digest MUST match what the ChipNet
     referee signs. This is a cross-component contract; record it as a `NOTE:` at the digest site so
     `feat-chipnet-integration` does not drift from it.

5. **Two balances, two visibilities.**
   - **Settled balance** = the `Ledger.Balance` chain (direct chits + finalized lifts only). This is the
     authoritative signed balance; `PerspectiveBalance` keeps reporting it.
   - **Reserved balance** = settled + every *open* `PendingLift` delta. New `PendingLift` pledges and new
     direct chits are gated against the reserved balance so concurrent lifts cannot collectively over-commit,
     and lift capacity advertisement (`LiftLading`) is computed from the reserved balance so pending lifts
     shrink advertised free capacity. This is the plan's "credit checks and trading variables see pending."
   - **NOTE (isolation model):** the reserved gate, the finalize-vs-void mutual exclusion, and the
     one-void-per-lift guard are all commit-time deferred CHECKs that only hold if Optimystic re-evaluates
     them against the latest committed snapshot at commit. This is the **same** open isolation question
     already flagged for `PartyKeyRevocation.NotLastKey` (`schema/draft1.qsql:137-146`) and
     `Ledger.InvoiceLink` (`schema/draft1.qsql:716-724`). Do not re-solve it here — reference those notes and
     add lift resolution to the same list.

## Schema shape

### New table: `PendingLift`

Conditional lift pledge on this edge. Issuer-signed (like a direct chit, but conditional on referee
resolution). Reserves capacity while *open*; enters the settled `Ledger` only if the referee commits.

| Column | Meaning |
|---|---|
| `LiftId text` | globally-unique lift identifier (from the ChipNet route); **primary key** — one pending chit per lift per strand |
| `RefereeKey text` | the agreed referee's public key; every resolution signature verifies against **this** key |
| `Issuer text check Issuer in ('S','F')` | side pledging value on this edge — sets the balance-delta sign (foil +Units, stock −Units), same convention as direct chits |
| `Units integer check Units > 0` | edge amount in **this** tally's denomination (per the committed route's rates) |
| `Date text check ValidDate(Date)` | pledge timestamp; the date the credit gate keys off |
| `Expiry text check ValidDate(Expiry)` | advisory staleness bound and part of the signed terms; **not** a per-strand finalize gate (see decision 2) |
| `SignerKey text` | authorized `PartyKey` of the issuing party |
| `Signature text` | issuer signs `Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry)` |

Constraints:
- `SignerAuthorized` — `SignerKey` in the issuing side's `AuthorizedKey` set (mirror `Ledger.SignerAuthorized`,
  branch on `Issuer`).
- `SignatureValid` — issuer signature over the lift-terms digest above.
- `ExpiryValid` — `julianday(Expiry) >= julianday(Date)`.
- `WithinReservedCredit` — prospective **reserved** balance (settled + all open pending, *including* this new
  pledge, which a plain ref already buffers in) within both parties' limits effective as of `New.Date`. Reuse
  the exact limit-lookup shape from `Ledger.WithinCreditLimits` (highest-`Revision` `CreditTerms` row whose
  `EffectiveDate <= New.Date`, per grantor; absent → 0).
- `InsertOnly` — reject delete/update.

### `Ledger` changes

- Add `Kind text check Kind in ('direct','lift') default 'direct'` — decision 1 / plan requirement 4.
- Add `LiftId text null` — set iff `Kind = 'lift'`; names the `PendingLift` being finalized.
- Add `RefereeSignature text null` — referee commit signature; `Kind = 'lift'` only.
- `SignerKey`/`Signature` become nullable — a finalize row is authorized by the referee commit + the
  pre-signed pending pledge, not a fresh issuer signature.
- Branch the existing constraints on `Kind`:
  - `SignerAuthorized`, `SignatureValid` (issuer), `InvoiceLink`, `ValidIssuer` — apply to `Kind = 'direct'`
    only (guard with `New.Kind = 'lift' or (…existing…)`). For `Kind = 'lift'` require `SignerKey`,
    `Signature`, `InvoiceId` all null.
  - New `LiftFinalize` constraint (for `Kind = 'lift'` only): (a) a matching `PendingLift` row exists for
    `New.LiftId`; (b) `New.Issuer`, `New.Units`, `New.Date` equal that pending row's (so the settled delta and
    the referee digest match the pledge); (c) `SignatureValid(Digest(Cid, New.LiftId, pending.RefereeKey,
    New.Issuer, New.Units, New.Date, pending.Expiry), New.RefereeSignature, pending.RefereeKey)`; (d)
    `NotVoided` — no `LiftVoid` row exists for `New.LiftId` (mutual exclusion; isolation caveat NOTE).
  - `BalanceCorrect` — unchanged; applies to every Ledger row (direct + finalized lift both carry a real
    delta).
  - `WithinCreditLimits` — guard as `New.Kind = 'lift' or (…existing settled check…)` (decision 3: finalize
    exempt). Update its stale comment (`schema/draft1.qsql:688-690`) — pending lifts are **no longer** "in
    Balance by construction"; they reserve via the new reserved gate and only settle on finalize.
  - New `WithinReservedCredit` constraint on `Ledger` (for `Kind = 'direct'` only): `New.Balance + Σ(open
    pending deltas)` within limits as of `New.Date`. Same limit lookup as `WithinCreditLimits`.

### New table: `LiftVoid`

Referee-signed void of a pending lift (explicit abort or post-timeout void — same mechanism, decision 2).

| Column | Meaning |
|---|---|
| `LiftId text` | **primary key** — one void per lift, also blocks double-void |
| `RefereeSignature text` | referee signs `Digest(Cid, LiftId, 'void')` |

Constraints:
- `PendingExists` — `New.LiftId` in `PendingLift`.
- `NotFinalized` — no `Ledger` row with `LiftId = New.LiftId and Kind = 'lift'` (mutual exclusion with
  finalize; isolation caveat NOTE).
- `RefereeVoidValid` — `SignatureValid(Digest(Cid, New.LiftId, 'void'), New.RefereeSignature,
  (select RefereeKey from PendingLift where LiftId = New.LiftId))`.
- `InsertOnly`.

### New views

- `OpenPendingLift` — `PendingLift` rows with no resolution: no `Ledger` finalize row and no `LiftVoid` row
  for the `LiftId`. This is the reservation set.
- `ReservedBalance` — one value: settled `Ledger.Balance` (latest by `Number`) + `Σ` over `OpenPendingLift`
  of `Units * (Issuer = 'F' ? +1 : -1)`. Base it on a 1-row source (e.g. `TallyCore`) so it is a single row,
  stock-perspective (same sign convention as raw `Ledger.Balance`).
- `ReservedPerspectiveBalance` — per party, mirrors `PerspectiveBalance` but off `ReservedBalance` (negated
  for the foil side).
- Point `LiftLading`'s balance join at `ReservedPerspectiveBalance` instead of `PerspectiveBalance` so
  advertised free capacity subtracts open pending lifts. Leave `PerspectiveBalance` reporting **settled**
  (authoritative signed balance) and resolve its TODO (`schema/draft1.qsql:518-522`) accordingly — the
  pending-aware view is the new `ReservedPerspectiveBalance`, not `PerspectiveBalance`.

## Edge cases & interactions

- **Pending → finalize is two inserts, never an update.** Verify no path mutates a `PendingLift` row; the
  pending stays, the finalize is a new `Ledger` row, and `OpenPendingLift` excludes it once the finalize
  lands. Test: insert pending → assert reserved balance reflects it and `Ledger.Balance` does not → finalize
  → assert `Ledger.Balance` now moved and reserved balance unchanged (pending no longer open, but its delta
  is now settled).
- **Finalize / void mutual exclusion (both directions).** finalize after void → rejected (`NotVoided`);
  void after finalize → rejected (`NotFinalized`); double-void → rejected (PK); second finalize of the same
  `LiftId` → rejected (a second Ledger `lift` row for the same `LiftId` must fail — verify `LiftFinalize`
  or a uniqueness guard catches it; `Ledger` PK is `Number`, so add an explicit "no existing finalize for
  this `LiftId`" clause to `LiftFinalize`).
- **Forged / replayed referee commit.** A commit signature valid for lift X or tally Y must fail here because
  the digest binds this `Cid` + `LiftId`. Test: sign a commit over a different `Cid` (or `LiftId`, or altered
  `Units`) → finalize rejected. A void signature presented as a commit (and vice-versa) → rejected (distinct
  digests).
- **Finalize is never credit-blocked.** Set credit limits so the settled balance after finalize would exceed
  them; finalize must still succeed (decision 3). Contrast: a *direct* chit or a new *pending* pledge that
  would exceed the reserved limit must be rejected.
- **Reserved gate counts open pending only.** A voided or finalized pending must drop out of
  `OpenPendingLift` immediately (so its capacity is released / moved to settled). Test both resolution paths
  free the reservation.
- **Sign of the pending delta.** A stock-issued pending pledge (`Issuer = 'S'`) reserves a *negative* delta;
  a foil-issued one a positive delta. Verify `ReservedBalance` and the two reserved gates use the same
  `Issuer = 'F' ? +1 : -1` convention as `BalanceCorrect`, and that a mix of positive and negative open
  pledges nets correctly.
- **Concurrent resolutions / concurrent pledges (isolation).** Two agents finalizing the same lift, or a
  finalize racing a void, or two pending pledges each individually within the reserved limit but jointly
  over it — all rely on Optimystic re-evaluating the deferred CHECK at commit. Same open question as
  `NotLastKey` / `InvoiceLink`; add lift resolution to that documented list, do not attempt to solve it.
- **Null-hygiene across `Kind`.** `Kind = 'direct'` rows must have `LiftId`/`RefereeSignature` null and
  `SignerKey`/`Signature` non-null; `Kind = 'lift'` rows the reverse (plus `InvoiceId` null). Enforce with
  explicit null/not-null clauses so a malformed row of either kind is rejected.
- **Empty-subquery NULL trap.** Several new CHECKs compare against a `PendingLift` sub-select (e.g.
  `LiftFinalize` reading `pending.RefereeKey`/`Expiry`). A Quereus CHECK passes when its expression is NULL —
  only a definite FALSE rejects (see `TallyContract.DenominationImmutable`, `schema/draft1.qsql:378-388`, and
  quereus `runtime/emit/constraint-check.ts`). If the pending row is absent the sub-selects are NULL and the
  finalize could slip through. Front `LiftFinalize` with an `exists (select 1 from PendingLift where LiftId =
  New.LiftId)` guard (as `DenominationImmutable` does) so a finalize with no matching pledge is a definite
  reject.
- **`ValidIssuer` pre-existing oddity.** `Ledger.ValidIssuer` (`schema/draft1.qsql:709`) references
  `IssuerSid`, but the column is `Issuer` ('S'/'F') and there is no `IssuerSid` column. This looks pre-existing
  and unrelated to lifts — do **not** fix it in this ticket; leave a one-line `NOTE:` at the site flagging it,
  and mention it in the review handoff so it can be triaged separately.

## TODO

- [ ] Add `PendingLift` table with the columns and constraints above (after `Ledger`, or wherever keeps the
      `TallyCore`/`AuthorizedKey` forward-references resolvable — follow existing view/table ordering).
- [ ] Add `Kind`, `LiftId`, `RefereeSignature` columns to `Ledger`; make `SignerKey`/`Signature` nullable.
- [ ] Branch `Ledger`'s existing constraints on `Kind` (direct-only) and add `LiftFinalize`,
      `WithinReservedCredit`; guard `WithinCreditLimits` to exempt `Kind = 'lift'`; add null-hygiene clauses.
- [ ] Update the stale `WithinCreditLimits` comment (`schema/draft1.qsql:688-690`) — pending lifts reserve,
      they are no longer "in Balance by construction."
- [ ] Add `LiftVoid` table.
- [ ] Add `OpenPendingLift`, `ReservedBalance`, `ReservedPerspectiveBalance` views; repoint `LiftLading` at
      `ReservedPerspectiveBalance`; resolve the `PerspectiveBalance` TODO comment
      (`schema/draft1.qsql:518-522`).
- [ ] Add `NOTE:` at the lift-terms digest site recording the ChipNet referee signing-order contract, and add
      lift resolution to the existing isolation-caveat cross-references (`NotLastKey`, `InvoiceLink`).
- [ ] Delete the two `Ledger` TODO comments (`schema/draft1.qsql:654`) now that they are realized.
- [ ] Update `docs/architecture.md`: the `Ledger` table row (line 110) and the "Ledger Operation" / "Lifts and
      ChipNet" sections to describe `PendingLift` / `LiftVoid` / reserved-vs-settled balance accurately; note
      `PerspectiveBalance` = settled, `ReservedPerspectiveBalance` / `LiftLading` = reserved.
- [ ] If Quereus has no runner wired yet, validate the schema loads however the sibling `feat-schema-invoices`
      / `feat-denomination-argument` tickets validated theirs (parse/load check); otherwise note the deferral
      in the review handoff. Do not skip or loosen any existing constraint to get a load.

## Also create

- `backlog/feat-lift-timeout-release` — a bilateral or bounded party-driven release for capacity stuck behind
  an unreachable referee (decision 2 liveness gap). Future concern, not needed for correctness now.
