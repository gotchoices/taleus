description: Added payment requests (invoices) to the tally schema — one party can formally ask the other for payment, and the answer is a traceable, signed chit (or a signed decline, or expiry).
prereq:
files: schema/draft1.qsql, docs/architecture.md
difficulty: medium
----

Delivered `feat-schema-invoices`: an `Invoice` table (signed payment request), a companion
`InvoiceDecline` table, a nullable `Ledger.InvoiceId` link folded into the chit signature, an
`InvoiceLink` gate on `Ledger`, and two derived views (`InvoiceState`, `OpenInvoice`). All in
`schema/draft1.qsql`; docs in `docs/architecture.md` (table list, views paragraph, Ledger Operation
"Invoice" bullet). House style kept throughout: insert-only, signature-gated, tally-Cid-bound
digests, no stored state.

## What an invoice is (one paragraph, for a reader without context)

A **requester** is the party that wants to *receive* value. It signs an `Invoice` asking the
counterparty for an exact number of units. The counterparty — the **payer** — answers in one of
three ways: (1) inserts a `Ledger` chit that references the invoice and pledges the exact amount
(from the *opposite* side, so the balance moves toward the requester), (2) signs an
`InvoiceDecline`, or (3) does nothing and lets an optional `ExpiryDate` lapse. The invoice's
state (`open` / `declined` / `expired` / `paid`) is **never stored** — it is derived by the
`InvoiceState` view with precedence `paid > declined > expired > open`.

## Design decisions baked in (all from the ticket, do not re-litigate)

- **Partial payment DISALLOWED** — one invoice, one chit, exact `Units`. Makes "paid" a
  single-existence test, no summation. Multi-chit partial payment is explicitly a *future* `feat-`,
  not built here.
- **State derived, never stored.** `paid` checked first so state is deterministic even if a decline
  and a chit both somehow commit.
- **Expiry is time-derived and advisory** (`julianday('now')` in the view only). A chit answering an
  already-expired invoice is NOT rejected at insert — gating on `now()` would make the chit insert
  volatile, which the schema avoids (mirrors the `WithinCreditLimits` backdating stance).
- **Invoices are NOT credit-gated at insert** — a request may exceed capacity; the *answering chit*
  is gated by the existing `WithinCreditLimits`, so an over-capacity invoice simply can't be paid
  until capacity exists.
- **Open invoices are advisory only** — exposed via `OpenInvoice` for the lift agent; NOT folded
  into `LiftLading` or the hard `WithinCreditLimits` gate.

## Validation use cases (the review floor — treat as a starting point, not exhaustive)

There is no runnable harness (see gaps), so these are inspection-verified expectations, not
executed tests. The reviewer should re-derive each and, if a Quereus runner gets wired, exercise them.

**Should be ACCEPTED:**
- Requester=`S` signs an `Invoice` with an authorized stock key → inserted; `InvoiceState` = `open`.
- `ExpiryDate` = null (never expires); or `ExpiryDate` ≥ `Date`.
- Payer answers: chit with `Issuer=F` (opposite of requester `S`), `Units` = invoice `Units`,
  `InvoiceId` = invoice `Id`, signed by an authorized foil key → accepted; state flips to `paid`.
- **Late payment of an expired invoice** still succeeds → state reads `paid` (precedence over
  `expired`).
- Payer signs `InvoiceDecline` before any chit → accepted; state `declined`.
- Ordinary chit with `InvoiceId` = null → accepted, unaffected by any invoice logic (regression: the
  default single-payment path is untouched).

**Should be REJECTED:**
- Invoice signed by the *wrong* party's key, or a revoked key → `SignerAuthorized` / `SignatureValid`.
- Invoice `Units` ≤ 0 → column check. `ExpiryDate` before `Date`, or a malformed `ExpiryDate` →
  `ExpiryValid`.
- Chit whose `Issuer` == invoice `Requester` (wrong direction / requester paying itself) →
  `InvoiceLink`.
- Chit whose `Units` ≠ invoice `Units` (partial or over) → `InvoiceLink`.
- Chit referencing a nonexistent `InvoiceId` → `InvoiceLink` (`exists` fails → definite FALSE reject).
- Second chit referencing an already-answered invoice → `InvoiceLink` `count(*) = 1` (see isolation
  caveat).
- Chit referencing an already-**declined** invoice → `InvoiceLink` not-declined clause.
- Decline by the requester (`DeclinedBy` == `Requester`) → `DeclinerIsPayer`.
- Decline of an already-paid invoice → `NotPaid`. Second decline of the same invoice → primary key.
  Decline of a nonexistent invoice → `InvoiceExists`.
- Any UPDATE/DELETE on `Invoice` / `InvoiceDecline` → `InsertOnly`.
- Tampering with a signed chit's `InvoiceId` → breaks `Ledger.SignatureValid` (digest now covers it).

## Known gaps & what the reviewer should scrutinize (written honestly)

- **No build/test scaffolding exists in `taleus`** (no `package.json`, no runner wiring). The schema
  also depends on host-registered functions (`SignatureValid`, `Digest`, `ValidDate`, `RandomUUID`)
  that only the app runner defines, so feeding the whole file to the sibling `quereus`
  `quoomb-cli` would fail on those regardless of this diff — no clean parse signal. **The SQL was
  validated by inspection against sibling constraint patterns only** (`Ledger`, `TallyContractProposal`,
  `CreditTerms`, `PartyKeyRevocation`). Confirm parse if/when a harness lands.
- **Concurrency / isolation (tripwire, NOTE at the `InvoiceLink` site).** The `count(*) = 1`
  double-payment guard and the pay-vs-decline race both depend on Optimystic re-evaluating the
  deferred CHECK against the *latest committed* snapshot at commit. If it validates only against each
  transaction's original read snapshot, two chits (or a chit + a decline) could both commit. This is
  the **same open question already flagged for `PartyKeyRevocation.NotLastKey`**
  (`schema/draft1.qsql:137-146`); the NOTE cross-references it. Not solved here by design — do not
  file a duplicate ticket; it rides the existing isolation question. Both racing actions are the
  payer's own, and `InvoiceState` resolves the ambiguity deterministically anyway.
- **NULL-passes-CHECK interplay.** A Quereus CHECK accepts when its expression is NULL (only a
  definite FALSE rejects). Verify the guards that rely on a *sibling* constraint to supply the
  definite FALSE: for a nonexistent `InvoiceId`, `DeclinerIsPayer`'s subquery is NULL (would pass),
  but `InvoiceExists` rejects with a definite FALSE; likewise `InvoiceLink`'s leading `exists`
  clause yields the definite FALSE for a dangling reference. Reviewer should confirm this holds under
  the runner's NULL semantics (same reasoning as `TallyContract.DenominationImmutable`'s `exists`
  guard).
- **`julianday('now')` in `InvoiceState` / `OpenInvoice`.** Volatile — fine in a plain view, NOT
  allowed in a MATERIALIZED view (same caveat as `CurrentCreditLimit`). If the target runner rejects
  volatile-in-view, fall back to computing `expired` in the application. Confirm on the target runner.
- **`Id` in the invoice digest.** `Invoice.Id` is `default RandomUUID()` and is covered by the
  signature (same pattern as `Ledger.Id`), so the app must generate the Id client-side, sign over it,
  then insert. Confirm the intended app flow matches (no schema change needed).
- **Digest column-ordering choice.** `InvoiceId` was appended at the *end* of the `Ledger` digest
  argument list. Pre-launch, no signed chits exist, so there is no migration concern; flag only if a
  canonical field order is later mandated.
