description: Review the new TallyCore table — the tally's identity record whose hash becomes its permanent ID, added to the shared schema file.
files: schema/draft1.qsql, docs/architecture.md
difficulty: easy
----

## What landed

Added `create table TallyCore` to `schema/draft1.qsql:277-304`, placed after the
`AuthorizedKey` view (`:251-254`) and before `PartyCertificate` (`:306`). No other file
changed — `docs/architecture.md:97` already described the table correctly ("party `Sid`s,
protocol version, creation time"), so no doc edit was needed.

Columns: `Cid, StockSid, FoilSid, ProtocolVersion, CreatedAt, SignerKey, Signature`.

Design (see the plan ticket / commit history for full rationale, summarized here):

- **Single row** (`primary key (/* 1 row */)`), insert-only.
- **Cid = `Digest(StockSid, FoilSid, ProtocolVersion, CreatedAt)`** — the row's own digest
  IS the tally's content-addressed ID. `CidCorrect` rejects a stored `Cid` that doesn't
  match.
- **Written post-seating**, not at strand provisioning: `StockSeated` requires `New.StockSid
  in (select Sid from Stock)`, `FoilSeated` requires `New.FoilSid in (select Sid from
  Foil)`. Since `Foil` is itself insert-gated on the invitee completing the out-of-band
  handshake, `TallyCore` structurally cannot be inserted before both parties are seated.
- **FoilSid folded into the Cid** (not deferred to a later step) — this is the ticket's
  main design call. Rationale: makes the tally identity commit to *both* parties, so a
  signature bound to this Cid (contracts, chits, pledges — every one of them signs
  `Digest((select Cid from TallyCore), …)`) cannot be replayed into a different tally, even
  one sharing the same `StockSid`. Rejected alternative: Cid excludes `FoilSid` (settable at
  provision time, before the invitee is known) — would only commit to
  initiator+timestamp, weakening the replay guarantee. See the in-schema NOTE blocks at
  `:256-276` for the full argument.
- **Initiator (stock) signs**: `SignerAuthorized` resolves `SignerKey` against
  `StockSid`'s authorized-key set only.

## Verify

No schema test harness exists yet (design phase, per `AGENTS.md`) — this was validated by
inspection, per the ticket's own instructions. Checked:

- Every existing `(select Cid|StockSid|FoilSid from TallyCore)` reference in the file now
  resolves to a real column. Confirmed via `grep -n "from TallyCore"
  schema/draft1.qsql` (single file match, all call sites use `Cid`, `StockSid`, or
  `FoilSid`): `TallyContractProposal`, `TallyContract`, `TradingVariable`, `CreditTerms`,
  `Invoice`, `InvoiceDecline`, `Ledger` (`SignerAuthorized`, `SignatureValid`,
  `ValidIssuer`, `LiftFinalize`), `PendingLift`, `LiftVoid`, and the views
  `PerspectiveBalance`, `ReservedBalance`, `ReservedPerspectiveBalance`,
  `CurrentCreditLimit`, `CurrentTradingVariable`, `LiftLading`. All resolve.
- Placement respects the file's forward-reference convention: `TallyCore` is defined before
  every table that references it, and itself only references `Stock`/`Foil`/`AuthorizedKey`,
  all defined earlier in the file — no cycle.
- Column set and constraint set match the plan ticket's design decision (post-seating
  write, `FoilSid` folded into `Cid`) exactly; no deviation taken during implementation.

## Known gaps / not done here (flag, don't silently absorb)

- **No runnable tests.** The "Key tests" section in the implement ticket (happy path,
  each-constraint-reject, cross-tally replay) is written but not executable — there is no
  Quereus runner wired up in this repo yet. Whoever adds the schema test harness should
  start there.
- **Pre-existing seating-order tension, out of scope.** `SignerAuthorized` here
  presupposes the stock party already has a `PartyKey` genesis row (an authorized key) —
  same dependency `Stock.SignerAuthorized` already carries at `schema/draft1.qsql:8`. The
  implement ticket flagged this as a pre-existing tension it deliberately did not fix
  (`Stock`'s genesis validates against `(select InvitationKey from Stock)`, which needs
  `Stock` first, while `Stock.SignerAuthorized` needs the genesis first). Not touched here
  either — worth a dedicated look if it ever blocks a real bootstrap flow, but nothing
  about `TallyCore` makes it worse or better.
- **`Ledger.ValidIssuer` bug, unrelated, pre-existing.** Line ~797 references a
  nonexistent `IssuerSid` column (should presumably be `Issuer`) — already flagged in a
  comment as a pre-existing draft placeholder from `feat-schema-lift-chits`, out of scope
  for this ticket, noted here only so it isn't mistaken for something this change touched.
- **`CreatedAt` trust.** Chosen unilaterally by the inserting (stock) party; not gated
  against `now()` (would make the insert non-deterministic/volatile, same reasoning applied
  elsewhere in the schema, e.g. `CreditTerms.Date`). A backdated value only changes the
  Cid, which both parties observe before signing anything against it — disputable, not
  silently exploitable. This is a documented design tradeoff, not a gap — no action needed,
  flagged for reviewer awareness only.

## Suggested review focus

- Confirm the post-seating / Cid-includes-FoilSid design decision against the plan
  ticket's original open question — this ticket resolved it, worth double-checking the
  reasoning holds.
- Confirm constraint coverage against the "Edge cases & interactions" list in the original
  implement ticket (insert-before-seating, wrong/swapped Sids, tampered Cid, non-authorized
  signer, empty ProtocolVersion, bad CreatedAt, delete/update, double-insert) — all are
  structurally covered by `StockSeated`/`FoilSeated`/`CidCorrect`/`SignerAuthorized`/
  `ProtocolVersionPresent`/`CreatedAtValid`/`InsertOnly`/single-row PK respectively; worth a
  second pass to confirm no gap.
