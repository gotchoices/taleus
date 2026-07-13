----
description: Let the tally ledger hold conditional lift entries that only become final when the lift's referee signs off, so multi-tally lifts commit atomically.
files: schema/draft1.sql, docs/architecture.md
----
Marked TODO in `schema/draft1.sql` ("lift vs manual", "pending lift"). The `Ledger` table currently models only direct (manual) chits.

Requirements:
- A lift chit is inserted in a **pending** state during lift setup: bound to the lift ID, the agreed referee key, its edge amount in this tally's denomination, and an expiry.
- Finalization is a later insert carrying the referee's commit signature over the lift terms; the schema verifies it locally (`verify()` against the referee key named in the pending row). Void/timeout likewise resolves the pending row without a balance effect.
- Balance chaining must accommodate pending rows: pending chits reserve capacity (credit checks and trading variables see them) but only finalized chits enter the signed running `Balance`. Design how `BalanceCorrect` treats the pending → final transition under the insert-only rule (e.g. pending row + resolution row pattern).
- Distinguish chit kinds (`direct`, `lift`) in the row so audit and UI can separate clearing traffic from payments.
- Cross-strand atomicity comes from every participating strand independently verifying the same referee signature — no cross-strand transaction. The schema must make a forged or replayed commit impossible (bind lift ID + tally CID into the signed digest).

Expected outcome: Ledger (or companion table) supports pending/finalized/voided lift entries; architecture.md's lift-mapping section stays accurate.
