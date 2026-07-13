description: Reviewed the new TallyCore table — the tally's identity record whose hash becomes its permanent ID, added to the shared schema file.
files: schema/draft1.qsql
difficulty: easy
----

## What landed

`create table TallyCore` at `schema/draft1.qsql:277-304` (after the `AuthorizedKey`
view, before `PartyCertificate`). Single-row, insert-only tally identity record.
Columns: `Cid, StockSid, FoilSid, ProtocolVersion, CreatedAt, SignerKey, Signature`.
Cid = `Digest(StockSid, FoilSid, ProtocolVersion, CreatedAt)` — the row's own digest
is the tally's content-addressed ID, the anchor every Cid-bound signature binds to.
Written post-seating, signed by an authorized key of the stock (initiator) party.

## Review findings

### Checked

- **All references resolve.** 33 `from TallyCore` call sites across the file
  (`grep -n "from TallyCore"`) — negotiation/ledger/lift tables and the balance views —
  select only `Cid`, `StockSid`, or `FoilSid`; every one is a real column on the new
  table. No dangling reference.
- **Pattern consistency.** TallyCore matches the established single-row signed-record
  shape used by `Stock` (`:1-18`): `primary key (/* 1 row */)`, `SignerAuthorized`
  against `AuthorizedKey`, `SignatureValid(Digest(founding fields), Signature, New.SignerKey)`,
  `InsertOnly` on delete/update. Bare-column refs inside `Digest(...)` (vs `New.`) follow
  the same convention as `Stock`/`PartyCertificate` — correct, not a bug.
- **Placement / forward-reference convention.** Defined before every table that
  references it; itself references only `Stock`/`Foil`/`AuthorizedKey`, all earlier in
  the file — no DDL cycle.
- **Constraint coverage** vs the implement ticket's edge-case list: insert-before-seating
  (`StockSeated`/`FoilSeated`), tampered Cid (`CidCorrect`), non-authorized/foil signer
  (`SignerAuthorized`), empty ProtocolVersion (`ProtocolVersionPresent`), bad CreatedAt
  (`CreatedAtValid` via `ValidDate`), delete/update (`InsertOnly`), double-insert
  (single-row PK). All structurally covered; verified `ValidDate` is a real host scalar
  used at `:295,495,496,678,698,738,953,954`.
- **Handoff claims spot-checked.** `docs/architecture.md:97` TallyCore row matches the
  implemented column set — no doc edit needed (confirmed). `Ledger.ValidIssuer`
  `IssuerSid` reference (`:847`) is genuinely pre-existing (flagged in-comment at
  `:844-846` from `feat-schema-lift-chits`) — not touched by this change, correctly
  out of scope.
- **Lint + tests green.** `yarn lint` clean, `yarn test` 105/105 pass. Change is
  schema-only (no TS), so this only confirms nothing else broke — no schema runner
  exists yet to exercise the constraints.

### Found & fixed inline (minor)

- **Wrong line citation in the new NOTE comment** (`:276`): cited "CreditTerms.Date at
  schema/draft1.qsql:433-438", but that range is `TallyContract.DenominationImmutable`;
  the actual `CreditTerms.Date` + backdate reasoning is at `:486-495`. Corrected the
  reference.

### Tripwire (parked in code, not ticketed)

- **Self-tally (`StockSid = FoilSid`) not rejected.** `StockSeated`/`FoilSeated` pin each
  Sid independently; nothing blocks both naming the same party. Genuinely conditional —
  honest two-party seating cannot produce it (`Foil` requires the invitee to sign with
  `Stock`'s out-of-band invitation secret), so it is fine now. Parked as a `NOTE:` at the
  TallyCore site (`:270-274` block) with the fix to apply (`StockSid <> FoilSid` check) if
  a formation path ever lets one party hold both roles.

### Major findings

None. Implementation is clean and consistent with the surrounding schema.

### Not done (unchanged from implement handoff, correctly out of scope)

- **No runnable schema tests.** No Quereus runner is wired up; constraint behavior
  (happy path, each-constraint reject, cross-tally replay) is validated by inspection
  only. Belongs to whoever adds the schema test harness — not filed as a ticket here since
  it is a whole-schema gap, not specific to TallyCore.
- **Pre-existing stock seating-order tension** (`Stock`'s genesis vs `SignerAuthorized`,
  `:8`) — TallyCore inherits the same dependency but makes it no worse; untouched.
- **`CreatedAt` chosen unilaterally by the stock party, not gated against `now()`** — a
  documented design tradeoff (backdate only changes the Cid, which both parties observe
  before signing against it), same reasoning as `CreditTerms.Date`. No action needed.
