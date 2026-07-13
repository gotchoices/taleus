----
description: The tally schema draft references several core tables and fields that were never actually defined, so it does not stand on its own yet.
files: schema/draft1.qsql
----

`schema/draft1.qsql` is an early draft. Several constraints reference symbols that no table in the file defines:

- `TallyCore` (the founding-fields table whose hash is the tally CID) — referenced by `TallyContractProposal`, `TallyContract`, `TradingVariable`, `Ledger`, and implied by `Stock`/`Foil`.
- `StockSid` / `FoilSid` — referenced as if columns of `TallyCore`.
- `IssuerSid` — used by `Ledger` as both a value and (incorrectly) a public key.

These are pre-existing draft gaps, not part of key-recovery work. Define the missing `TallyCore` table (party `Sid`s, protocol version, creation time, CID) per `docs/architecture.md` (§ Schema and Integrity Model, `TallyCore` row), wire the `StockSid`/`FoilSid`/`IssuerSid` references to it, and reconcile the placeholder signature arguments so the schema is internally consistent.

Note: `key-multi-and-revoke` introduces a `SignerKey` column and an `AuthorizedKey` view that the signature constraints on these tables should use; sequence this after that work (or reconcile with it) to avoid re-touching the same constraints twice.
