----
description: Record the credit limit and notice period each party grants the other, as signed, revisable terms attached to the tally contract, and refuse any chit that would push a balance past the limit in force.
prereq:
files: schema/draft1.qsql, docs/architecture.md, docs/old/tally.md
difficulty: medium
----
Credit terms are the credit one party (the **grantor**) extends to the other: a **limit** (how far the grantor lets the counterparty owe it) and a **call/notice period** (how much warning the grantor must give before *reducing* that limit). Today the tally contract carries only a `ContractCid`; the terms columns are a `TODO` on `TallyContract` (`schema/draft1.qsql:299`). This ticket models terms, ties them to the contract's bilateral signature, and gates the ledger against them.

Reference: `docs/old/tally.md` § *Credit Terms Chunk* (MyCHIPs model); `docs/architecture.md` § *Schema and Integrity Model* (house rules) and § *Ledger Operation*.

## Design decisions (resolved — build to these)

**Representation: separate revisioned `CreditTerms` table, not contract columns.** Credit terms are **unilateral** — only the grantor signs. A value both parties sign (like the denomination) can live as a column on the bilaterally-signed `TallyContract`; a value only one party signs cannot. So terms get their own per-party revisioned, insert-only, grantor-signed table — the same shape as `TradingVariable` (`schema/draft1.qsql:331`), which is also per-`Sid` unilateral published policy. Terms also evolve *after* the contract is signed (revisions with notice-delayed effect) without renegotiating the contract, which a contract column could not express.

**The contract covers terms-in-force by reference.** "The contract's bilateral signature must cover the terms in force at acceptance" is satisfied by `TallyContract` naming each party's operative `CreditTerms` revision in its signed digest. Because `CreditTerms` rows are insert-only and grantor-signed, referencing `(Sid, Revision)` transitively covers the terms content. Later unilateral revisions do **not** touch the contract.

**Runtime uses latest-effective, not the contract reference.** The contract reference is the acceptance snapshot for the record. Ledger/lift checks use the *latest effective* revision (see below), because terms change post-contract.

**Generic argument mechanism (for `feat-denomination-argument`).** Two argument shapes, split by signature model:
- **Unilateral, per-party** → the `CreditTerms` table pattern established here.
- **Bilateral, shared** → columns on `TallyContract` / `TallyContractProposal`, folded into the existing signed digests.

The denomination is **bilateral** (one unit binds both sides of every chit) and its ticket explicitly forbids per-party placement — so it attaches as `TallyContract` columns, **not** in `CreditTerms`. The extension point is the contract-row digest; this ticket leaves it clean for denomination to widen. Do **not** try to make denomination and credit terms share one table — they differ in exactly the property (who signs) that this split turns on.

## `CreditTerms` table

Per-grantor, revisioned, insert-only, grantor-signed. Column `CreditLimit` (not `Limit` — reserved word). Notice period in **days** (`CallDays`), so `julianday()` arithmetic is clean. `EffectiveDate` makes the notice delay a signed, verifiable field.

```sql
-- Credit one party (Sid = grantor) extends to the counterparty. UNILATERAL: only the grantor
-- signs. Same shape as TradingVariable (per-Sid, revisioned, insert-only, grantor-signed) --
-- it is the same kind of published unilateral policy. Semantics (docs/old/tally.md):
--   CreditLimit: max the grantor lets the counterparty owe it -> caps how far the grantor's
--                PERSPECTIVE balance may rise in its favor.
--   CallDays:    days of notice the grantor must give before a RESTRICTIVE change takes effect.
--   Args:        optional JSON for contract-specific credit parameters; null = none (generic
--                extension point for "additional terms").
--   EffectiveDate: when this revision governs. Revision 1 and permissive changes == Date
--                (immediate); restrictive changes >= Date + prior revision's CallDays.
create table CreditTerms (
    Sid text,               -- grantor (party extending credit)
    Revision integer,
    CreditLimit integer default 0 check (CreditLimit >= 0),
    CallDays integer default 0 check (CallDays >= 0),
    Args text,              -- optional JSON, contract-specific params
    Date text check ValidDate(Date),                    -- grantor-signed issuance timestamp
    EffectiveDate text check ValidDate(EffectiveDate),
    SignerKey text,         -- authorized PartyKey of Sid that signed this revision
    Signature text,

    primary key (Sid, Revision),
    constraint PartyOfTally check (Sid in (select StockSid from TallyCore union select FoilSid from TallyCore)) on insert,
    -- committed.* excludes the row being inserted (follows PartyKey's documented reasoning at
    -- schema/draft1.qsql:59; note TradingVariable/PartyCertificate use a plain ref here -- see
    -- Edge cases, "committed.* vs plain ref").
    constraint RevisionMonotonicInt check (Revision = Coalesce((select max(Revision) from committed.CreditTerms CT where CT.Sid = New.Sid), 0) + 1) on insert,
    constraint SignerAuthorized check (New.SignerKey in (select PublicKey from AuthorizedKey AK where AK.Sid = New.Sid)) on insert,
    constraint SignatureValid check (SignatureValid(
        Digest((select Cid from TallyCore), Sid, Revision, CreditLimit, CallDays, Args, Date, EffectiveDate),
        Signature,
        New.SignerKey
    )) on insert,
    -- Notice rule. Prior = immediately preceding revision for this grantor (committed).
    --   Revision 1 (no prior): effective immediately.
    --   Permissive (CreditLimit non-decreasing AND CallDays non-decreasing): immediate.
    --   Restrictive (CreditLimit decreases OR CallDays decreases): grantor owes the counterparty
    --   the PRIOR revision's CallDays of notice -> EffectiveDate >= Date + prior.CallDays.
    constraint EffectiveDateValid check (
        (New.Revision = 1 and julianday(New.EffectiveDate) = julianday(New.Date))
        or (New.Revision > 1 and
            case
                when New.CreditLimit >= (select CreditLimit from committed.CreditTerms CT where CT.Sid = New.Sid and CT.Revision = New.Revision - 1)
                 and New.CallDays   >= (select CallDays   from committed.CreditTerms CT where CT.Sid = New.Sid and CT.Revision = New.Revision - 1)
                then julianday(New.EffectiveDate) = julianday(New.Date)
                else julianday(New.EffectiveDate) >= julianday(New.Date)
                     + (select CallDays from committed.CreditTerms CT where CT.Sid = New.Sid and CT.Revision = New.Revision - 1)
            end)
    ) on insert,
    constraint InsertOnly check (0) on delete, update
);
```

## Ledger credit gate

Add a `WithinCreditLimits` constraint to `Ledger` (`schema/draft1.qsql:401`). The prospective `Balance` (stock perspective; `BalanceCorrect` already chains it) must sit within the credit each party has extended, **effective as of this chit's `Date`**. Deterministic — keyed to the chit's own signed date, so no `now()`.

- Stock-granted limit caps how far `Balance` may **rise** (foil's debt to stock): `Balance <= StockEffectiveLimit`.
- Foil-granted limit caps how far it may **fall** (stock's debt to foil): `Balance >= -FoilEffectiveLimit`.
- Effective limit for a grantor = `CreditLimit` of the **highest-`Revision`** `CreditTerms` row whose `EffectiveDate <= chit Date`; absent any row → `0`.

```sql
constraint WithinCreditLimits check (
    Balance <= coalesce((
        select CT.CreditLimit from CreditTerms CT
        where CT.Sid = (select StockSid from TallyCore)
          and julianday(CT.EffectiveDate) <= julianday(New.Date)
        order by CT.Revision desc limit 1), 0)
    and Balance >= -coalesce((
        select CT.CreditLimit from CreditTerms CT
        where CT.Sid = (select FoilSid from TallyCore)
          and julianday(CT.EffectiveDate) <= julianday(New.Date)
        order by CT.Revision desc limit 1), 0)
) on insert
```

Picking max-`Revision` among effective rows is correct even when a future-dated restrictive revision and a later immediate permissive revision both exist: the permissive one, once effective, has the higher revision and supersedes. Pending-lift capacity folds in by construction — once pending lift chits are written as `Ledger` rows they are in `Balance`, so this check counts them with no extra machinery (interaction flagged below).

## Contract terms reference

Add to **`TallyContract`** (`schema/draft1.qsql:296`): `StockCreditTermsRevision integer`, `FoilCreditTermsRevision integer`. Fold both into the `StockSignature` and `FoilSignature` digests (currently `Digest((select Cid from TallyCore), Number, ContractCid)`) so the bilateral signature covers them. Add existence constraints:

```sql
constraint StockTermsExist check (New.StockCreditTermsRevision in (select Revision from CreditTerms CT where CT.Sid = StockSid)) on insert, update,
constraint FoilTermsExist  check (New.FoilCreditTermsRevision  in (select Revision from CreditTerms CT where CT.Sid = FoilSid))  on insert, update,
```

Add the matching columns to **`TallyContractProposal`** (`schema/draft1.qsql:274`) and fold them into its `Signature` digest, so a proposal names the terms revisions it expects the accepted contract to lock. (The load-bearing coverage is on `TallyContract`; the proposal carries them for a complete offer.)

## Lift capacity (`LiftLading`)

`LiftLading` (`schema/draft1.qsql:388`) already carries the note "credit-terms limits will further cap lading when modeled." Cap the receiver's accumulation by its effective granted limit: a lift raises the *receiver's* perspective balance, which is the counterparty's debt to the receiver — bounded by the credit the **receiver** extended. Cap `FreeUnits`/`RewardedUnits` so `Balance + moved <= min(Bound, receiver's effective CreditLimit)`.

This needs a "current" (not chit-dated) effective limit. Add a helper view:

```sql
-- Effective (latest-effective-revision) credit limit each party grants, as of now.
-- julianday('now')/date('now') are VOLATILE -- fine in a plain view; NOT allowed in a
-- MATERIALIZED view (Quereus hard-rejects volatile there). If a future runner rejects
-- volatile-in-view, fall back to computing the effective revision in the lift agent
-- (application) and keep the deterministic chit-dated Ledger gate as the safety boundary.
create view CurrentCreditLimit as
    select P.Sid,
        coalesce((select CT.CreditLimit from CreditTerms CT
                  where CT.Sid = P.Sid and julianday(CT.EffectiveDate) <= julianday('now')
                  order by CT.Revision desc limit 1), 0) as CreditLimit
    from (select StockSid as Sid from TallyCore union select FoilSid as Sid from TallyCore) P;
```

The hard safety gate is the deterministic `Ledger.WithinCreditLimits`; `LiftLading`/`CurrentCreditLimit` are advisory capacity advertisement.

## Edge cases & interactions

- **Revision 1 / no prior.** Initial grant is effective immediately (`EffectiveDate = Date`); monotonic counter starts at 1.
- **Permissive vs restrictive classification.** Restrictive = `CreditLimit` decreases **or** `CallDays` decreases (shortening notice is itself restrictive — otherwise a grantor could instantly shorten notice, then yank). Permissive = both non-decreasing → immediate. A revision that raises the limit but shortens `CallDays` is restrictive and must be delayed. Test the mixed case explicitly.
- **Notice boundary.** Restrictive `EffectiveDate` exactly at `Date + prior.CallDays` is allowed (`>=`).
- **Backdated `Date`.** A grantor could set `Date` in the past to shorten the real-world notice. Inherent to a unilateral, grantor-signed timestamp; both parties replicate the strand and observe it, so it is disputable, not silently exploitable. Not solved cryptographically here — `NOTE:` at the table. (If a bound is later wanted, gate `Date` against `date('now')` — but that makes the insert volatile.)
- **Concurrent revisions from two grantor devices.** Both read the same committed max and compute the same `Revision`; the `(Sid, Revision)` primary key + Optimystic write ordering serialize them, the loser retries against the new max — same mechanism as concurrent `PartyKey` adds.
- **`committed.*` vs plain ref.** This table uses `committed.CreditTerms` for the monotonic and prior-revision lookups, per `PartyKey`'s carefully-reasoned rule (`schema/draft1.qsql:54-59`). **Note:** `TradingVariable` (`:343`) and `PartyCertificate` (`:264`) use a *plain* ref for the same monotonic check — an apparent inconsistency in the existing schema. Confirm the correct choice against the Quereus deferral model when a runner exists; do not "fix" the siblings inside this ticket. Record as a `NOTE:` at the constraint. (Tripwire, not a ticket.)
- **Default limit 0 blocks the first chit.** With no `CreditTerms` row for a grantor, its effective limit is 0, so `Balance` cannot move against it. This matches the MyCHIPs "zero credit" semantics and the essential-chunks rule (a valid open tally publishes at least one terms revision per party). Formation must insert initial `CreditTerms` (and the contract must reference them) before the first nonzero chit. This is a behavior change to `Ledger` — but there is no build/test scaffolding today, so nothing regresses; state it in the handoff.
- **Effective-as-of-date selection.** With a pending future restrictive revision plus a later immediate permissive revision, the chit-dated check must pick the highest-revision *effective* row. Test: rev1 limit 100; rev2 restrictive limit 50 effective in 30 days; rev3 permissive limit 120 immediate → a chit today sees 120, a chit in 40 days (rev2 alone) would have seen 50.
- **Pending lift chits (interaction with `feat-chipnet-integration`).** The gate counts pending reservations *by construction* once pending chits are `Ledger` rows in the balance chain. Ledger still carries `-- TODO: pending lift` (`:414`); when that lands, confirm a pending chit's balance contribution is included and a voided lift unwinds it. Flag in handoff; do not build pending-lift modeling here.
- **`TallyCore` is undefined.** `StockSid`/`FoilSid`/`Cid` are referenced across the whole schema but `TallyCore` is never `create table`d (see `backlog/debt-schema-tallycore-table`). `CreditTerms` references it exactly as `TradingVariable` does, so it is no worse off — but nothing in this schema can be executed/tested until `TallyCore` exists. Note the dependency in the handoff; the credit-terms design does not wait on it.
- **`julianday`/`ValidDate`.** `julianday` is a Quereus builtin (volatile); `ValidDate` is the project's custom validity helper already used by `Ledger.Date`. Both assumed present in the runtime.

## TODO

- Add the `CreditTerms` table to `schema/draft1.qsql` (place near `TradingVariable`).
- Replace the `-- TODO: Credit terms` line on `TallyContract` with `StockCreditTermsRevision`/`FoilCreditTermsRevision` columns; fold both into `StockSignature` and `FoilSignature` digests; add `StockTermsExist`/`FoilTermsExist` constraints.
- Add the same two revision columns to `TallyContractProposal`; fold into its `Signature` digest.
- Add `WithinCreditLimits` to `Ledger`.
- Add the `CurrentCreditLimit` view; extend `LiftLading` to cap receiver accumulation by `min(Bound, effective CreditLimit)`; remove the stale "when modeled" clause from the `LiftLading` comment.
- Add `NOTE:` comments: backdated-`Date` trust caveat; `committed.*` vs plain-ref inconsistency.
- Update `docs/architecture.md`:
  - Add `CreditTerms` to the § *Schema and Integrity Model* table; refine the `TallyContract` row to say it references each party's operative `CreditTerms` revision.
  - Refine formation § step 4 and § *Core Concepts* "Credit terms" to distinguish unilateral per-party terms (`CreditTerms`) from the bilateral denomination argument.
  - Note in § *Ledger Operation* that chits are gated by the effective credit limit (with the pending-lift interaction).
- Tests (once a runner/harness exists — none today):
  - grantor publishes rev1 limit 100 → counterparty may owe up to 100; a chit that would exceed is rejected.
  - permissive raise (100→150) effective immediately; restrictive drop (150→80) with `CallDays=30` rejected unless `EffectiveDate >= Date+30`.
  - mixed change (limit up, `CallDays` down) treated as restrictive (delayed).
  - chit-dated effective selection across the pending-restrictive + later-permissive case above.
  - `TallyContract` insert with a `CreditTermsRevision` that has no matching row is rejected; both signatures cover the referenced revisions.
