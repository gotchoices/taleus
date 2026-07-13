----
description: Add the tally's identity record to the schema — the founding facts whose hash becomes the tally's permanent ID that every signature refers to.
files: schema/draft1.qsql, docs/architecture.md
difficulty: easy
----

Add the `TallyCore` table to `schema/draft1.qsql`. Several tables already reference it
(`select Cid from TallyCore`, `select StockSid ... from TallyCore`,
`select FoilSid from TallyCore`) but it is not yet defined — this ticket defines it so
those cross-references resolve.

## What `TallyCore` is

The tally's **identity record**: the founding facts of the tally (both parties' `Sid`s,
the protocol version, the creation timestamp). Their digest **is** the tally CID — the
per-strand anchor that every Cid-bound signature binds to (`TallyContractProposal`,
`TallyContract`, `TradingVariable`, `CreditTerms`, `Invoice`, `InvoiceDecline`, `Ledger`,
`PendingLift`, `LiftVoid` all sign `Digest((select Cid from TallyCore), …)`). Because the
Cid folds in both party `Sid`s, a signed row cannot be replayed into a tally with a
different party pair — the Cid differs.

## Design decision: written post-seating, CID includes the foil identity

The plan ticket asked us to resolve how `FoilSid` gets into the row when the initiator
provisions the strand before the invitee is known. **Resolved: the row is written after
seating, and the CID digest includes `FoilSid`.** Rationale:

- **No Cid-bound row exists before negotiation.** The seating tables (`Stock`, `Foil`,
  `PartyKey`, `PartyCertificate`) deliberately do **not** bind to `Cid` — their digests
  omit it (verify: `Stock` = `Digest(Sid, InvitationKey)`, `Foil` = `Digest(Sid)`,
  `PartyKey` = `Digest(Sid, Revision, PublicKey, AuthKey)`, `PartyCertificate` =
  `Digest(PartySid, Revision, Certificate)`). Every table that *does* bind `Cid` belongs to
  step 4 (negotiation) or later (`docs/architecture.md` "Tally Formation"). So by the time
  the Cid is first needed, both `Stock` and `Foil` rows exist and `FoilSid` is known.
- **Including `FoilSid` makes the identity commit to BOTH parties.** The cross-tally replay
  guarantee becomes complete: a chit/contract/pledge signed for this Cid cannot validate in
  any tally with a different party pair. The provision-time alternative (Cid excludes the
  foil identity) would commit only to the initiator + timestamp, weakening that guarantee —
  rejected.
- **Placement is structurally enforced.** `FoilSeated` (below) requires a `Foil` row to
  exist, so `TallyCore` cannot be inserted until the invitee has seated. `StockSeated` and
  the stock-authorized signature likewise require the initiator seated. This pins the row
  between seating (step 3) and negotiation (step 4) with no extra sequencing logic.

Who inserts it: the **initiator (stock)**, matching the plan's "created by the initiator"
requirement — `SignerKey` resolves against `StockSid`'s authorized set.

## Table definition

Add this **after the `AuthorizedKey` view** (currently `schema/draft1.qsql:251-254`) and
**before `PartyCertificate`** — `SignerAuthorized` references `AuthorizedKey`, and the
negotiation/ledger tables that reference `TallyCore` all appear later in the file (they
already forward-reference it, resolved at statement-build time like the schema's existing
`committed.*` / view forward references — see the notes at `schema/draft1.qsql:237-250`).

```sql
-- Tally identity record (feat-schema-tally-core). The founding facts of the tally, whose digest IS the
-- tally CID -- the per-strand anchor every Cid-bound signature (contracts, chits, pledges) binds to, so a
-- row signed for this tally can never be replayed into another. Single row, insert-only, created once at
-- formation. Created AFTER seating (both Stock and Foil rows exist) and BEFORE negotiation: no Cid-bound
-- table is written until negotiation, and the seating tables (Stock/Foil/PartyKey/PartyCertificate)
-- deliberately do NOT bind to Cid, so the invitee's Sid is already known when this row is needed. Folding
-- FoilSid into the Cid makes the identity commit to BOTH parties -- see the replay NOTE.
--
-- Cid = Digest(StockSid, FoilSid, ProtocolVersion, CreatedAt). The stored Cid must equal that digest
-- (CidCorrect); StockSid/FoilSid must be the actually-seated parties (StockSeated/FoilSeated pin them to
-- the single-row Stock/Foil tables), so even a malicious initiator cannot name a counterparty who never
-- seated. Signed by an authorized key of the STOCK (initiator) party -- "created by the initiator".
--
-- NOTE (replay): both party Sids are folded into the Cid, so the tally identity cryptographically commits
-- to WHICH two parties it binds. A chit/contract/pledge digest binding this Cid cannot validate in any
-- tally with a different party pair. Excluding FoilSid (the provision-time alternative) would commit only
-- to the initiator + timestamp, weakening cross-tally replay protection -- rejected.
-- NOTE (CreatedAt trust): CreatedAt is chosen by the inserting (stock) party. A dishonest value only
-- changes the Cid, which both parties observe before binding any negotiation signature to it -- disputable,
-- not silently exploitable. Not gated against now() (that would make the insert volatile/non-deterministic,
-- same reasoning as CreditTerms.Date at schema/draft1.qsql:433-438).
create table TallyCore (
    Cid text,              -- tally id: digest of the founding fields below; the per-strand signature anchor
    StockSid text,         -- initiator (stock) party identity
    FoilSid text,          -- invitee (foil) party identity
    ProtocolVersion text,  -- Taleus tally protocol version in force at formation
    CreatedAt text,        -- formation timestamp
    SignerKey text,        -- authorized PartyKey of StockSid that signed this row
    Signature text,

    primary key (/* 1 row */),
    -- Cid is the content address of the founding fields: the stored value must equal their digest.
    constraint CidCorrect check on insert (New.Cid = Digest(StockSid, FoilSid, ProtocolVersion, CreatedAt)),
    -- StockSid/FoilSid must name the actually-seated parties (both tables are single-row), so the identity
    -- cannot be minted against a counterparty who never seated. Requiring the Foil row also pins creation
    -- to AFTER the invitee seats.
    constraint StockSeated check on insert (New.StockSid in (select Sid from Stock)),
    constraint FoilSeated check on insert (New.FoilSid in (select Sid from Foil)),
    constraint ProtocolVersionPresent check on insert (New.ProtocolVersion is not null and New.ProtocolVersion <> ''),
    constraint CreatedAtValid check on insert (ValidDate(New.CreatedAt)),
    -- Initiator (stock) creates the identity: SignerKey resolves against the STOCK party's authorized set.
    constraint SignerAuthorized check on insert (New.SignerKey in (select PublicKey from AuthorizedKey AK where AK.Sid = New.StockSid)),
    constraint SignatureValid check on insert (SignatureValid(
        Digest(StockSid, FoilSid, ProtocolVersion, CreatedAt),
        Signature,
        New.SignerKey
    )),
    constraint InsertOnly check on delete, update (0)
);
```

## Edge cases & interactions

- **Insert before invitee seats** → `FoilSeated` rejects (no `Foil` row). Structural
  enforcement of the post-seating ordering.
- **Insert before initiator seats** → `StockSeated` and `SignerAuthorized` reject (no
  `Stock` row / no stock `PartyKey` genesis, so no authorized key).
- **Second `TallyCore` insert** → single-row primary key (`/* 1 row */`) rejects. Identity
  is created exactly once.
- **Wrong / swapped Sids** (e.g. `StockSid` = foil's Sid) → `StockSeated`/`FoilSeated`
  reject; each must match its own seated single-row table.
- **`Cid` not equal to the digest of the founding fields** → `CidCorrect` rejects. The Cid
  is self-verifying content-addressing, not a free value.
- **Signature by a non-authorized key, or by the foil party's key** → `SignerAuthorized`
  rejects (checked against `StockSid`'s authorized set only — the initiator provisions).
- **Empty / null `ProtocolVersion`** → `ProtocolVersionPresent` rejects. **Malformed
  `CreatedAt`** → `CreatedAtValid` (`ValidDate`) rejects.
- **delete / update** → `InsertOnly` rejects.
- **Cross-tally replay (the core guarantee):** every Cid-bound table signs
  `Digest((select Cid from TallyCore), …)`; because the Cid folds in both `Sid`s, a chit /
  contract / pledge signed for this tally fails signature validation in any other tally
  (different Cid). This is the property the whole design exists to provide.
- **Deferred-constraint snapshot:** `StockSeated`/`FoilSeated`/`SignerAuthorized` use plain
  (buffered+committed) refs to `Stock`/`Foil`/`AuthorizedKey`. Whether `TallyCore` is
  inserted in its own transaction (seats already committed) or the same transaction as the
  `Foil` seat (seat buffered), a plain ref sees the row either way — correct in both. No
  `committed.*` needed here (no "before this change" assertion — unlike the monotonic /
  self-authorization constraints elsewhere).
- **Bootstrap dependency:** `SignerAuthorized` presupposes the stock party has a `PartyKey`
  genesis (an authorized key) by insert time — the *same* dependency `Stock.SignerAuthorized`
  (`schema/draft1.qsql:8`) already carries. There is a pre-existing seating-order tension for
  the stock side (its `PartyKey` genesis validates against `(select InvitationKey from Stock)`,
  which needs `Stock` first, while `Stock.SignerAuthorized` needs the genesis first) — this is
  **not introduced by this ticket** and is out of scope; do not try to fix it here.

## Key tests (for when a runner exists)

There is no schema test harness yet (`AGENTS.md`: "No package/build scaffolding yet —
design phase"). Validate this ticket by inspection: the table binds cleanly and every
existing `(select Cid|StockSid|FoilSid from TallyCore)` reference now resolves. When a
Quereus runner exists, these are the tests to write:

- **Happy path:** seat `Stock` + `Foil` (+ stock/foil `PartyKey` genesis), insert
  `TallyCore` with `Cid = Digest(StockSid, FoilSid, ProtocolVersion, CreatedAt)` signed by a
  stock-authorized key → accepted. Expected: exactly one row; `Cid` non-null.
- **Reject:** `FoilSeated` before `Foil` exists; `CidCorrect` with a tampered `Cid`;
  `SignerAuthorized` with a foil key or an unregistered key; second insert (PK); update /
  delete (`InsertOnly`); empty `ProtocolVersion`; bad-date `CreatedAt`.
- **Replay:** build two tallies A and B with the same `StockSid` but different `FoilSid`;
  confirm a `Ledger` chit signed against A's `Cid` fails `SignatureValid` when inserted into
  B — the digests differ because the Cids differ.

## TODO

- Insert the `TallyCore` table into `schema/draft1.qsql` after the `AuthorizedKey` view,
  before `PartyCertificate` (see placement note above).
- Skim the file for every `from TallyCore` reference and confirm each resolves to a real
  column (`Cid`, `StockSid`, `FoilSid`): `TallyContractProposal`, `TallyContract`,
  `TradingVariable`, `CreditTerms`, `Invoice`, `InvoiceDecline`, `Ledger`, `PendingLift`,
  `LiftVoid`, and the views `PerspectiveBalance`, `ReservedBalance`,
  `ReservedPerspectiveBalance`, `CurrentCreditLimit`, `CurrentTradingVariable`, `LiftLading`.
- Confirm `docs/architecture.md` line ~97 (the `TallyCore` schema-table row) still matches
  the implemented fields — it already reads "party `Sid`s, protocol version, creation time";
  update only if the final column set diverges. No new doc section is expected.
