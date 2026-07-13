----
description: Add payment requests (invoices) so one party can formally ask the other for payment and get a traceable, signed response.
files: schema/draft1.sql, docs/architecture.md
----
Marked TODO in `schema/draft1.sql` ("payment request (invoices)").

Requirements:
- An `Invoice` row is signed by the requesting party: amount (units in the tally denomination), date, reference (machine-readable JSON), memo.
- The payer answers by inserting a chit that references the invoice; an invoice can also be declined or expire.
- Invoice state (open / paid / declined / expired) should be derivable from the tables, not stored mutable — consistent with the insert-only model.
- Lift agents and credit checks should be able to "see" open invoices (they signal upcoming balance movement — relevant to trading-variable decisions).
- Consider partial payment: one invoice answered by multiple chits, or disallow and require exact match. Document the choice.

Expected outcome: `Invoice` table + chit linkage in the schema; Ledger Operation section of architecture.md stays accurate.
