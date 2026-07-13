description: Review the new credit-terms schema — the per-party signed limit/notice table, the contract reference that locks it, and the ledger gate that refuses chits exceeding the limit in force.
prereq:
files: schema/draft1.qsql, docs/architecture.md, docs/old/tally.md
----
Implemented `feat-schema-credit-terms` per the plan ticket's resolved design. All work is in `schema/draft1.qsql` (declarative Quereus sApp schema, design-phase — see *Validation* for why nothing was executed) and `docs/architecture.md`. No code outside the schema/docs.

## What was built

**New `CreditTerms` table** (`schema/draft1.qsql:383`, placed right after `TradingVariable`). Per-grantor, revisioned, insert-only, grantor-signed — same shape as `TradingVariable`. Columns: `Sid` (grantor), `Revision`, `CreditLimit` (named `CreditLimit`, not the reserved word `Limit`), `CallDays` (notice period in **days**, for clean `julianday()` arithmetic), `Args` (optional JSON — the generic "additional terms" extension point), `Date` + `EffectiveDate` (both `ValidDate`-checked), `SignerKey`, `Signature`. Constraints:
- `PartyOfTally` — grantor must be one of the two tally parties.
- `RevisionMonotonicInt` — `Revision = max(committed)+1` (reads `committed.CreditTerms`; see tripwire below).
- `SignerAuthorized` + `SignatureValid` — signed by an authorized `PartyKey` of the grantor; digest binds `Cid, Sid, Revision, CreditLimit, CallDays, Args, Date, EffectiveDate`.
- `EffectiveDateValid` — the notice rule. Rev 1 → immediate (`EffectiveDate = Date`). Rev > 1 permissive (`CreditLimit` **and** `CallDays` both non-decreasing) → immediate. Restrictive (`CreditLimit` **or** `CallDays` decreases) → `EffectiveDate >= Date + prior.CallDays`. Shortening notice is itself restrictive.
- `InsertOnly`.

**`Ledger.WithinCreditLimits`** (`schema/draft1.qsql:536`) — the hard safety gate. Prospective (stock-perspective) `Balance` must sit within each party's credit **effective as of this chit's own signed `Date`** (deterministic, no `now()`): `Balance <= stock's effective CreditLimit` and `Balance >= -(foil's effective CreditLimit)`. Effective limit = `CreditLimit` of the highest-`Revision` `CreditTerms` row whose `EffectiveDate <= chit Date`; no row → `0`.

**`CurrentCreditLimit` view** (`schema/draft1.qsql:452`) — advisory latest-effective-limit-as-of-`now` per party; feeds `LiftLading`.

**`LiftLading` capped** (`schema/draft1.qsql:485`) — receiver accumulation now bounded by `min(Bound, receiver's effective CreditLimit)`: `FreeUnits = max(0, min(Target, Cap) - Balance)`, `RewardedUnits = max(0, Cap - max(Balance, Target))`. Stale "credit-terms will further cap when modeled" comment removed.

**`TallyContract`** (`schema/draft1.qsql:300`) — replaced the `-- TODO: Credit terms` line with `StockCreditTermsRevision`/`FoilCreditTermsRevision` columns, folded both into `StockSignature` **and** `FoilSignature` digests (so the bilateral signature covers the terms in force at acceptance by reference), and added `StockTermsExist`/`FoilTermsExist` existence constraints.

**`TallyContractProposal`** (`schema/draft1.qsql:274`) — same two columns, folded into its `Signature` digest (a complete offer names the revisions it expects the contract to lock; the load-bearing coverage stays on `TallyContract`).

**`docs/architecture.md`** — `CreditTerms` row added to the § *Schema and Integrity Model* table + `TallyContract` row refined; § *Core Concepts* "Credit terms" and formation § step 4 now distinguish unilateral per-party terms from the bilateral denomination argument; § *Ledger Operation* gains a "Credit gate" bullet (with the pending-lift interaction).

## Validation — nothing was executed (design phase)

**No test/lint run, and none possible.** There is no `package.json`, no Taleus schema runner, and no build scaffolding in-tree (only unrelated `tess/` tooling) — same posture as the `feat-portfolio-state` / `feat-exchange-rate-quotes` reviews. The schema is written for structural consistency with its siblings, not executed. `.pre-existing-known.md` is not present; no pre-existing failures to report. **Treat the test list below as a specified floor, not a landed suite** — it lands when a runner exists.

## Test/use-case floor (once a runner exists)

- Grantor publishes rev1 `CreditLimit=100` → counterparty may owe up to 100; a chit pushing `Balance` past the grantor's effective limit is rejected by `WithinCreditLimits`.
- Permissive raise (100→150, `CallDays` non-decreasing) → immediate (`EffectiveDate = Date`). Restrictive drop (150→80) with `CallDays=30` → **rejected** unless `EffectiveDate >= Date + 30`; boundary `EffectiveDate = Date + 30` exactly is **allowed** (`>=`).
- **Mixed change** (limit up, `CallDays` down) is **restrictive** → delayed. Test explicitly — this is the subtle case.
- **Chit-dated effective selection**: rev1 limit 100; rev2 restrictive limit 50 effective in 30 days; rev3 permissive limit 120 immediate → chit today sees **120**; a chit dated 40 days out with only rev2 effective would see 50. Confirms max-`Revision`-among-effective picks the right row.
- Default-0: with no `CreditTerms` row for a grantor, effective limit is 0 → the first nonzero chit against it is rejected. Formation must insert initial `CreditTerms` before the first chit.
- `TallyContract` insert naming a `CreditTermsRevision` with no matching row → rejected (`StockTermsExist`/`FoilTermsExist`); both signatures must cover the referenced revisions (tamper with a revision number → signature fails).

## Known gaps & things to scrutinize (be adversarial here)

- **`TallyCore` is undefined across the whole schema.** `StockSid`/`FoilSid`/`Cid` are referenced everywhere but `TallyCore` is never `create table`d (tracked in `backlog/debt-schema-tallycore-table`). `CreditTerms`, `WithinCreditLimits`, and the views reference it exactly as the existing siblings do, so this design is no worse off — but **nothing in this schema can be executed until `TallyCore` exists.** This is the blocker for ever running the test floor above.
- **`Ledger.WithinCreditLimits` is a behavior change** — the first chit now requires a published `CreditTerms` revision (zero-credit default). No scaffolding exists so nothing regresses, but a future formation flow must insert initial `CreditTerms` (and the contract must reference them) before the first nonzero chit. Verify the design intends this MyCHIPs "essential chunk" semantics (it does, per `docs/old/tally.md`).
- **`CurrentCreditLimit` uses `julianday('now')` (volatile) inside a plain view.** Fine in a plain view; a `NOTE:` at the view warns it is **not** allowed in a MATERIALIZED view (Quereus hard-rejects volatile there). If a future runner rejects volatile-in-view entirely, the fallback (documented at the site) is to compute the effective revision in the lift agent and lean on the deterministic chit-dated `Ledger` gate as the safety boundary. Reviewer: confirm the plain-view assumption against Quereus when a runner exists.
- **Pending-lift interaction** (`feat-chipnet-integration`). The gate counts pending reservations *by construction* — once pending lift chits are `Ledger` rows they are in `Balance`. But `Ledger` still carries `-- TODO: pending lift` (`schema/draft1.qsql:512`); when that lands, confirm a pending chit's balance contribution is included and a voided lift unwinds it. Not built here.
- **`LiftLading` cap math.** `Cap = min(Bound, CreditLimit)`; `min(Target, Bound) = Target` because `Bound >= Target` is a `TradingVariable` constraint. Worth an independent check that the `FreeUnits`/`RewardedUnits` clamps behave when `CreditLimit < Target` (free portion should clamp to `CreditLimit`, rewarded to 0) and when `CreditLimit` sits between `Target` and `Bound`.

## Tripwires (recorded at the site — index only, per rules)

- `schema/draft1.qsql`, `CreditTerms.RevisionMonotonicInt` (`~:396`) — **`committed.*` vs plain-ref inconsistency.** This table uses `committed.CreditTerms` (per `PartyKey`'s reasoned rule at `:54-59`), but sibling `TradingVariable` (`RevisionMonotonicInt`) and `PartyCertificate` use a **plain** ref for the same monotonic check — an apparent pre-existing inconsistency. `NOTE:` at the constraint says: confirm the correct choice against the Quereus deferral model when a runner exists; do **not** "fix" the siblings inside this ticket. Conditional, not a task.
- `schema/draft1.qsql`, `CreditTerms` table header (`~:377`) — **backdated-`Date` trust caveat.** A grantor could set `Date` in the past to shorten real-world notice before a restrictive change bites. Inherent to a unilateral grantor-signed timestamp; both parties replicate and observe the signed `Date`, so it is disputable, not silently exploitable. `NOTE:` at the table; a `date('now')` bound is possible later but would make the insert volatile.
