----
description: Model the orderly wind-down of a tally — either party can request closure, after which only balance-reducing activity is allowed until it reaches zero and closes.
files: schema/draft1.sql, docs/architecture.md, docs/old/tally.md
----
The lifecycle states Closing/Closed (architecture.md § Tally Lifecycle) have no schema backing yet.

Requirements:
- A signed close-request row from either party moves the tally to Closing.
- While Closing, constraints accept only chits (direct or lift) that move the balance toward zero.
- Closed = balance zero with a close request in force; no further ledger inserts accepted.
- Zero credit terms ≠ closing (see `docs/old/tally.md` § Zero Credit vs. Close Request) — closing is a distinct, signed state, not a terms revision.
- Consider whether closure needs to be bilateral to take effect (a unilateral close request that traps the counterparty's positive balance is unacceptable; a unilateral request that only restricts *new* credit is fine). Document the semantics.
- Interaction with strand lifecycle: a Closed tally strand can hibernate permanently / archive via Sereus; the data remains as evidence.

Expected outcome: close-request table + Closing/Closed constraint enforcement in the schema.
