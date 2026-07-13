----
description: Define the tally's identity record — the founding facts whose hash becomes the tally's permanent ID that every signature refers to.
files: schema/draft1.sql, docs/architecture.md
----
Several constraints in `schema/draft1.sql` already reference a `TallyCore` table (`select Cid from TallyCore`, `StockSid`/`FoilSid`) that is not yet defined. Design and add it.

Requirements:
- Single row, insert-only, created by the initiator at strand provisioning time.
- Carries the founding fields: both party `Sid`s (stock and foil), protocol version, creation timestamp.
- The tally CID is derived as a digest of these fields, and is the value every other table's signature digest binds to — so a signed row cannot be replayed into a different tally.
- Decide how the foil `Sid` gets into the row when the initiator provisions before the invitee is known: either the row is written after seating (`Foil` insert) with a constraint tying it to `Stock`/`Foil`, or the CID derivation excludes the foil identity. Document the choice and its replay implications.
- Constraint pattern should match the rest of the schema: signature-gated insert, `InsertOnly` on delete/update.

Expected outcome: `TallyCore` defined in the schema; existing cross-references (`TallyContractProposal`, `TallyContract`, `Ledger`) resolve; architecture.md's schema table stays accurate.
