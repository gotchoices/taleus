----
description: Several schema rules that mean "compare against the previous row" are written in a way that accidentally compares against the row being inserted, so they can never pass — the schema needs a consistent fix.
files: schema/draft1.qsql
----

# Deferred self-referential constraints read the wrong snapshot

## Background (plain language)

The tally schema (`schema/draft1.qsql`) enforces its rules as SQL `CHECK` constraints. The database engine (Quereus) runs any `CHECK` that contains a sub-query **at commit time**, and at that moment a plain reference to a table (e.g. `select max(Revision) from PartyCertificate`) already **includes the row currently being inserted**. To read the state *before* this insert you must reference the pre-transaction snapshot instead: `committed.PartyCertificate`. (Verified against Quereus's own `43-transition-constraints.sqllogic` test and the `committed.<table>` pseudo-schema documented in `../quereus/docs/architecture.md`.)

Because of this, any constraint of the form "my value must equal the previous row's value + 1" that references its own table with a *plain* reference can never be satisfied — the sub-query sees the new row, so "previous max" is the new row itself.

The key-authority work (`key-multi-and-revoke`) hit and fixed this inside `PartyKey` (its `RevisionMonotonicInt` now uses `committed.PartyKey`, and `AuthKeyAuthorized` uses `committed.*` for a security reason too — see the comments there). The same latent bug remains in the sibling tables that ticket did not rewrite.

## Sites to fix

- **`PartyCertificate.RevisionMonotonicInt`** — `select max(Revision) from PartyCertificate ...` must read `committed.PartyCertificate`.
- **`TradingVariable.RevisionMonotonicInt`** — `select max(Revision) from TradingVariable ...` must read `committed.TradingVariable`.
- **`Ledger.BalanceCorrect`** — two problems: the prior-row lookup `select Balance from Ledger where Number = Number - 1` compares a column to itself (`Number = Number - 1` is always false; it should correlate to the new row, `Number = New.Number - 1`), **and** it should read the prior row from `committed.Ledger` for the same snapshot reason.
- **`Ledger.ClosingReducesBalance`** and **`PendingLift.ClosingReducesReserved`** (added by `feat-schema-tally-close`) — same class of deferred-snapshot read. `ClosingReducesBalance` already uses the correct `Number = New.Number - 1` prior-row form (not the `Number = Number - 1` bug above) but still reads a plain `Ledger` ref, and both gates' `exists (select 1 from CloseRequest)` guard reads `CloseRequest` with a plain ref — under snapshot-only validation a concurrent close-request or balance-growing chit could slip past. Convert the prior-row read to `committed.Ledger` and the close-request existence checks to `committed.CloseRequest` when this fix lands, so the closing gates are swept in the same pass. (Both sites carry an inline `NOTE:` pointing at the shared `PartyKeyRevocation.NotLastKey` isolation question.)

Use the fixed `PartyKey` constraints as the template for the pattern (plain ref where the new row *should* be counted, `committed.*` where it must be excluded).

## Why this is dormant, not urgent

There is no Taleus test runner or build yet — the schema is a design-phase draft that nothing executes, so these constraints do not fail anything today. It becomes real work the moment the schema is first loaded and exercised against Quereus. File as debt, fix before/with the first schema-execution milestone.

## Overlap note

This touches the same constraints as `debt-schema-core-tables` (which wires up the undefined `TallyCore`/`StockSid`/`FoilSid`/`IssuerSid` symbols). Whoever lands second should reconcile rather than re-touch — ideally fix both the snapshot semantics and the symbol wiring in one pass over each constraint.
