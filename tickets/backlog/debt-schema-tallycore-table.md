----
description: The tally's core identity record — the two parties' IDs and the tally's content hash — is used everywhere in the schema but the table that holds it was never actually written.
files: schema/draft1.qsql, docs/architecture.md
----
Almost every table in `schema/draft1.qsql` reads `TallyCore` — its `StockSid`, `FoilSid`, and `Cid` columns anchor party identity and every signature digest (e.g. `TradingVariable`, `TallyContract`, `Ledger`, `PartyKey.TwoParties` indirectly, and the new `CreditTerms`). `docs/architecture.md` § *Schema and Integrity Model* describes it: "Tally identity: the founding fields (party `Sid`s, protocol version, creation time) whose hash is the tally CID that all other signatures bind to. Single row."

But there is no `create table TallyCore` anywhere in the schema. Every reference is a forward reference to a table that does not exist, so the schema cannot be created or exercised as-is. This is a pre-existing gap, not introduced by any one feature — it surfaced while planning `feat-schema-credit-terms`.

What the table needs (from the doc and its usages):
- `StockSid`, `FoilSid` — the two parties' IDs (hash of each party's genesis key).
- `Cid` — the tally content address: the hash of the founding fields, which all other signatures bind to.
- Protocol version, creation timestamp — the founding fields named in the doc.
- Single-row (`primary key (/* 1 row */)`), insert-only, following the house style of `Stock`/`Foil`.
- Decide how `Cid` is established/validated (self-hash of the founding fields) and how the row is seated during formation (§ *Tally Formation* step 3 — it must exist before `PartyKey`/certificates that digest against `Cid`).

This is schema-foundational: it likely wants to land ahead of, or alongside, the next schema change that touches signatures. Sized as its own ticket because it defines identity semantics (CID derivation, formation ordering) that are broader than any single feature that consumes it.
