description: Add payment requests (invoices) to the tally schema so one party can formally ask the other for payment and the answer is a traceable, signed chit.
files: schema/draft1.qsql, docs/architecture.md
difficulty: medium
----

Replace the `-- TODO: payment request (invoices)` placeholder in `schema/draft1.qsql` (line ~553)
with an `Invoice` table, a companion `InvoiceDecline` table, a `Ledger` link column, and two
derived views. Keep the schema's house style: insert-only, signature-gated, tally-Cid-bound
digests, no mutable state.

## What an invoice is

A party formally asks the counterparty for payment. The **requester** is the party that wants to
*receive* value (the future chit recipient). The counterparty — the **payer** — answers by
inserting a `Ledger` chit that references the invoice, or declines it, or lets it expire.

Direction falls out of the existing chit convention (`schema/draft1.qsql:588`, `BalanceCorrect`):
a foil-issued chit raises Balance (foil pledges to stock), a stock-issued chit lowers it. So the
answering chit's `Issuer` is always the **opposite** of the invoice `Requester` — if Stock
requests payment, Foil must issue the chit that raises Balance toward Stock.

## Resolved design decisions

- **Partial payment is DISALLOWED.** One invoice is answered by exactly one chit whose `Units`
  equal the invoiced `Units`. Rationale: it makes `paid` a single-existence test (a referencing
  chit exists) with no summation, keeps state derivation deterministic under insert-only history,
  and avoids the ambiguous "half-paid then expired/declined" states. A payer who wants to pay a
  different amount issues an ordinary unlinked chit and leaves the invoice open; the requester can
  issue a fresh invoice. If multi-chit partial payment is ever wanted, it is a separate future
  `feat-` (relax `InvoiceLink` to allow N chits summing to `Units`, and change `paid` to a
  sum-reached test) — do **not** build it here.
- **State is derived, never stored** — consistent with the insert-only model. Precedence
  `paid > declined > expired > open`, realized in the `InvoiceState` view. Because `paid` is
  checked first, the derived state stays deterministic even if a decline and a chit both somehow
  commit (see edge cases).
- **Expiry is time-derived and advisory.** `ExpiryDate` is optional (null = never expires).
  `expired` is computed with `julianday('now')` in the view only. A chit answering an already-
  expired invoice is **not** rejected at insert — gating on `now()` would make the chit insert
  volatile, which the schema deliberately avoids (mirror the `WithinCreditLimits` / backdating
  stance at `schema/draft1.qsql:603`). A late payment still succeeds and `paid` wins over
  `expired` by precedence.
- **Invoices are NOT gated against credit limits at insert.** An invoice is a *request*, not a
  commitment; requesting more than current capacity is legitimate (the payer may raise credit
  first). The answering chit is gated by the existing `WithinCreditLimits` as usual, so an
  over-capacity invoice simply cannot be paid until capacity exists. This also keeps invoice
  insert non-volatile.
- **Decline needs a signed row** (`InvoiceDecline`); expiry does not. Only the payer (the
  counterparty of the requester) may decline.
- **Open invoices are exposed to the lift agent** via an `OpenInvoice` view — advisory signal of
  upcoming balance movement, read by the agent/credit-check application layer. It is **not** folded
  into `LiftLading` capacity math or the hard `WithinCreditLimits` gate (that is discretionary
  policy, out of scope here).

## Schema shape

`Invoice` — signed by the requester:

```sql
create table Invoice (
    Id text default RandomUUID(),
    Requester text check Requester in ('S', 'F'),  -- party requesting payment (future recipient)
    Units integer check Units > 0,                 -- smallest denomination unit
    Date text check ValidDate(Date),
    ExpiryDate text null,                           -- null = never expires
    Reference text,                                 -- machine-readable JSON (stored as text, no parser)
    Memo text,
    SignerKey text,                                 -- authorized PartyKey of the requesting party
    Signature text,

    primary key (Id),
    constraint SignerAuthorized check (New.SignerKey in (
        select PublicKey from AuthorizedKey AK
        where AK.Sid = (select case when New.Requester = 'S' then StockSid else FoilSid end from TallyCore)
    )) on insert,
    constraint SignatureValid check (SignatureValid(
        Digest((select Cid from TallyCore), Id, Requester, Units, Date, ExpiryDate, Reference, Memo),
        Signature, New.SignerKey
    )) on insert,
    -- ExpiryDate, when present, must be a valid date at or after Date.
    constraint ExpiryValid check (
        New.ExpiryDate is null
        or (ValidDate(New.ExpiryDate) and julianday(New.ExpiryDate) >= julianday(New.Date))
    ) on insert,
    constraint InsertOnly check (0) on delete, update
);
```

`InvoiceDecline` — signed by the payer (the non-requester side):

```sql
create table InvoiceDecline (
    InvoiceId text,
    DeclinedBy text check DeclinedBy in ('S', 'F'),  -- must be the payer (counterparty of requester)
    SignerKey text,
    Signature text,

    primary key (InvoiceId),                         -- at most one decline per invoice
    constraint InvoiceExists check (New.InvoiceId in (select Id from Invoice)) on insert,
    -- Only the payer may decline: DeclinedBy is the side that is NOT the requester.
    constraint DeclinerIsPayer check (
        New.DeclinedBy <> (select Requester from Invoice where Id = New.InvoiceId)
    ) on insert,
    constraint SignerAuthorized check (New.SignerKey in (
        select PublicKey from AuthorizedKey AK
        where AK.Sid = (select case when New.DeclinedBy = 'S' then StockSid else FoilSid end from TallyCore)
    )) on insert,
    constraint SignatureValid check (SignatureValid(
        Digest((select Cid from TallyCore), InvoiceId, DeclinedBy),
        Signature, New.SignerKey
    )) on insert,
    -- Cannot decline an invoice already answered by a chit.
    constraint NotPaid check (not exists (select 1 from Ledger L where L.InvoiceId = New.InvoiceId)) on insert,
    constraint InsertOnly check (0) on delete, update
);
```

`Ledger` — add a nullable `InvoiceId` column, fold it into the chit digest, and add the link
constraint:

```sql
    InvoiceId text null,   -- set when this chit answers an invoice
```

Add `InvoiceId` to the existing `Ledger.SignatureValid` `Digest(...)` argument list (the chit
signature must cover its invoice link) and add:

```sql
    -- If this chit answers an invoice: the invoice must exist, the chit must be issued by the
    -- PAYER (opposite side from the requester), pledge EXACTLY the invoiced units, be the only
    -- chit answering it, and the invoice must not already be declined.
    constraint InvoiceLink check (
        New.InvoiceId is null
        or (
            exists (select 1 from Invoice where Id = New.InvoiceId)
            and New.Issuer <> (select Requester from Invoice where Id = New.InvoiceId)
            and New.Units = (select Units from Invoice where Id = New.InvoiceId)
            and (select count(*) from Ledger where InvoiceId = New.InvoiceId) = 1
            and not exists (select 1 from InvoiceDecline where InvoiceId = New.InvoiceId)
        )
    ) on insert,
```

(The `count(*) = 1` uses a plain ref so the buffered new row is included → exactly one match for a
first payment. Concurrency caveat below.)

Views (place near `PerspectiveBalance` / `LiftLading`, and update the `PerspectiveBalance` TODO at
`schema/draft1.qsql:518-520` to point at `OpenInvoice`):

```sql
-- Invoice state, derived from the tables (never stored). Precedence paid > declined > expired > open.
-- 'expired' is time-derived (julianday('now') is VOLATILE -- fine in a plain view, NOT allowed in a
-- MATERIALIZED view; same caveat as CurrentCreditLimit at schema/draft1.qsql:504). It is deliberately
-- NOT gated at chit insert -- a late payment still succeeds and 'paid' wins by precedence.
create view InvoiceState as
    select I.Id, I.Requester, I.Units, I.Date, I.ExpiryDate,
        case
            when exists (select 1 from Ledger L where L.InvoiceId = I.Id) then 'paid'
            when exists (select 1 from InvoiceDecline D where D.InvoiceId = I.Id) then 'declined'
            when I.ExpiryDate is not null and julianday(I.ExpiryDate) < julianday('now') then 'expired'
            else 'open'
        end as State
    from Invoice I;

-- Open (unanswered, undeclined, unexpired) invoices -- advisory signal of upcoming balance movement
-- for the lift agent / credit-check application layer. NOT folded into LiftLading or WithinCreditLimits.
create view OpenInvoice as
    select Id, Requester, Units, Date, ExpiryDate from InvoiceState where State = 'open';
```

## Edge cases & interactions

- **Requester / signer binding.** `Requester` ∈ {S,F}; `SignerKey` must be authorized for exactly
  that party's `Sid`. A row signed by the wrong party, or by a revoked key, must be rejected
  (reuses `AuthorizedKey`). Two-party invariant holds trivially (no new `Sid` introduced).
- **Wrong-side payment.** A chit whose `Issuer` equals the invoice `Requester` (requester paying
  its own invoice / wrong direction) must be rejected by `InvoiceLink`.
- **Amount mismatch.** A chit whose `Units` ≠ invoice `Units` must be rejected (exact-match rule).
- **Dangling reference.** A chit referencing a nonexistent `InvoiceId` must be rejected.
- **Double payment (concurrency).** Two chits referencing the same invoice get different `Ledger.Number`,
  so they do **not** collide on the primary key — the `count(*) = 1` guard only rejects the second
  one if the deferred CHECK is re-evaluated against the latest committed snapshot at commit. This is
  the **same open isolation question already flagged** for `PartyKeyRevocation.NotLastKey`
  (`schema/draft1.qsql:137-146`): if Optimystic validates only against each transaction's original
  read snapshot, both could commit. Add a `NOTE:` at `InvoiceLink` cross-referencing that existing
  note; do not attempt to solve isolation here.
- **Pay-then-decline / decline-then-pay race.** `InvoiceDecline.NotPaid` rejects a decline once a
  chit exists; `InvoiceLink` rejects a chit once a decline exists — each is a commit-time subquery
  with the same isolation caveat as double-payment. Both actions are the payer's own, so this only
  ever produces self-inflicted ambiguity, and `InvoiceState` resolves it deterministically anyway
  (`paid` is checked before `declined`). Name it; don't over-engineer.
- **Decline by requester.** `DeclinerIsPayer` must reject the requester declining its own invoice.
- **Expiry boundaries.** `ExpiryDate` null → never expires; `ExpiryDate` before `Date` → rejected
  at insert (`ExpiryValid`); a chit answering an expired invoice still succeeds and flips state to
  `paid`. Confirm `julianday('now')` is usable in a plain (non-materialized) view on the target
  runner; if not, fall back to computing `expired` in the application, same as the
  `CurrentCreditLimit` note.
- **Reference JSON.** Stored as opaque text like `Ledger.Reference`; no parser (house rule).
- **Digest coverage.** `InvoiceId` must be added to the `Ledger` chit digest so the link cannot be
  altered without invalidating the signature; the `Invoice` digest binds `(select Cid from TallyCore)`
  so an invoice cannot be replayed into another tally.

## TODO

- Add `Invoice` table to `schema/draft1.qsql`, replacing the `-- TODO: payment request (invoices)`
  line at ~553.
- Add `InvoiceDecline` table.
- Add nullable `InvoiceId` column to `Ledger`, fold it into the `Ledger.SignatureValid` digest, and
  add the `InvoiceLink` constraint (with the concurrency `NOTE:` cross-referencing the
  `PartyKeyRevocation.NotLastKey` isolation note).
- Add `InvoiceState` and `OpenInvoice` views; update the `PerspectiveBalance` TODO comment
  (`schema/draft1.qsql:518-520`) to reference `OpenInvoice` instead of a bare "open invoices" note.
- Update `docs/architecture.md`:
  - Table list (~line 108): keep `Invoice`, add `InvoiceDecline`; mention the two views alongside
    the other computed views (~line 111).
  - Ledger Operation "Invoice" bullet (~line 229): state the exact-match single-chit rule, the
    derived-state precedence, decline vs. expire, and that open invoices are advisory to the lift
    agent (not a hard gate).
- Sanity-check the SQL parses / constraints are well-formed against the Quereus runner if one is
  wired up; otherwise validate by inspection against the sibling tables' constraint patterns (there
  is no build/test scaffolding yet — note this in the review handoff).
