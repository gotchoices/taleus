description: Added payment requests (invoices) to the tally schema — one party can formally ask the other for payment, and the answer is a traceable, signed chit (or a signed decline, or expiry).
files: schema/draft1.qsql, docs/architecture.md
----

Completed `feat-schema-invoices`. Reviewed the implement diff (commit `291b378`) adversarially;
implementation is correct, house-style-consistent, and honestly documented. No inline fixes were
required, no follow-up tickets filed. Details below.

## What shipped

- `Invoice` — signed, insert-only payment request. `Requester in ('S','F')` is the future value
  *recipient*; `Units > 0` exact; optional `ExpiryDate` (null = never); Cid-bound digest; requester's
  authorized key gates the signature.
- `InvoiceDecline` — signed refusal by the payer (counterparty of requester). One row per invoice
  (PK on `InvoiceId`), only valid before a chit answers (`NotPaid`).
- `Ledger.InvoiceId` (nullable) folded into the chit signature digest; `InvoiceLink` gate enforces
  exist / payer-issues / exact-Units / single-chit / not-declined.
- Views `InvoiceState` (paid>declined>expired>open, never stored) and `OpenInvoice` (advisory,
  *not* folded into `LiftLading` / `WithinCreditLimits`).
- Docs: table list, views paragraph, Ledger Operation "Invoice" bullet, and the `PerspectiveBalance`
  TODO all updated to match.

## Review findings

**Correctness (checked, no defects found).**
- *Payment direction* — `InvoiceLink`'s `New.Issuer <> Requester` is correct in both directions.
  Requester `S` (stock wants value) forces Foil to issue → `BalanceCorrect` `+Units` → balance rises
  toward stock. Requester `F` forces Stock to issue → `-Units` → foil's negated perspective rises.
  Both move value toward the requester, as intended.
- *State precedence* — `paid` first is deterministic under the only way both a chit and a decline can
  coexist (a payer-self-inflicted race; sequential inserts are mutually blocked by `InvoiceLink`'s
  not-declined clause and `InvoiceDecline.NotPaid`).
- *Exact-payment guard* — `New.Units = Invoice.Units` plus `count(*) = 1` makes "paid" a single
  existence test; a wrong-amount or second chit is rejected. Verified the `count(*)` relies on the
  same "plain ref = buffered+committed self-count" semantics already used by
  `PartyKeyRevocation.NotLastKey`.

**NULL / CHECK semantics (checked, correct).** Quereus CHECKs pass on NULL; only a definite FALSE
rejects. Confirmed each guard that leans on a sibling for the definite FALSE: dangling `InvoiceId` →
`InvoiceLink`'s leading `exists` is FALSE (rejects) and `InvoiceDecline.InvoiceExists` is FALSE
(rejects) where `DeclinerIsPayer`'s subquery would be NULL. Same reasoning as
`TallyContract.DenominationImmutable`.

**Regression — default single-payment path (checked, unaffected).** Ordinary chits carry
`InvoiceId = null`; `InvoiceLink`'s first disjunct short-circuits to accept. The concern that a
trailing NULL in the `Ledger` signature digest could break every ordinary chit was investigated and
dismissed: `Reference`/`Memo` were already nullable columns inside that same digest *before* this
change, so "Digest tolerates NULL args" is a pre-existing schema assumption this diff does not
introduce. No new risk.

**Docs (checked, current).** Read every touched doc region. `docs/architecture.md` table list
(`Invoice`/`InvoiceDecline`/`Ledger`), views paragraph (`InvoiceState`/`OpenInvoice`), and the
Ledger Operation "Invoice" bullet all reflect the shipped schema. No stale invoice references
elsewhere (the app-surfaces "payments/invoices" line at :253 is a UX list, still accurate). Schema
has no table-of-contents/enumeration needing an entry.

**Lint / tests (not runnable — stated with reason, not skipped).** `taleus` has no build/test/lint
scaffolding (only `tess/package.json`, the ticket tool; no `package.json`, no runner). The schema
also calls host-registered functions (`SignatureValid`, `Digest`, `ValidDate`, `RandomUUID`) that
only the app runner defines, so feeding `draft1.qsql` to the sibling `quereus quoomb-cli` would fail
on those regardless of this diff — no clean parse signal exists yet. SQL was therefore verified by
inspection against sibling constraint patterns (`Ledger`, `PartyKeyRevocation`, `TallyContract`,
`CreditTerms`), the method the implementer used and disclosed. **Parse/behavior must be confirmed
when a harness lands** — carried in the tripwires below, not as a blocker.

**Tripwires (recorded by the implementer; verified adequate, no duplicate tickets).**
- *Commit-time isolation* — `NOTE` at the `InvoiceLink` site (`schema/draft1.qsql:716-724`): the
  `count(*) = 1` double-pay guard and the pay-vs-decline race both assume Optimystic re-evaluates the
  deferred CHECK against the latest committed snapshot. Correctly cross-referenced to the identical
  open question on `PartyKeyRevocation.NotLastKey` (`:137-146`). Rides that question; not re-filed.
  Both racing actions are the payer's own and `InvoiceState` resolves the ambiguity deterministically.
- *Volatile-in-view* — `NOTE` at `InvoiceState` (`:557-560`): `julianday('now')` is VOLATILE, fine in
  a plain view but rejected in a MATERIALIZED view; same caveat as `CurrentCreditLimit`. Fallback is
  app-side `expired` computation. Confirm on the target runner.
- *Digest field order / `Id` client-generation* — `InvoiceId` appended at the end of the `Ledger`
  digest and `Invoice.Id`/`Ledger.Id` are `default RandomUUID()` yet signature-covered, so the app
  must generate the Id client-side and sign over it. Pre-launch (no signed chits exist), so no
  migration concern; flagged only if a canonical field order is later mandated.

**Minor observations (no action).** `InvoiceLink` repeats `(select … from Invoice where Id =
New.InvoiceId)` three times; not factorable in a Quereus CHECK without a scalar/view and matches the
repeated-subquery style of `WithinCreditLimits`, so left as-is. Declining an already-*expired*
invoice yields state `declined` (decline precedes expired) — intentional per the declared precedence,
an explicit signal is stronger than a lapse; noted only for future readers.

**Empty categories.** No major findings (nothing warranting a new ticket). No security findings
(signature/key-authorization gating mirrors the audited `Ledger`/`PartyKey` tables; nothing new
exposed). No performance findings (views are per-invoice scalar subqueries, same shape as existing
credit-limit views; no hot path introduced pre-launch).

## Deferred-by-design (from the plan, not re-litigated)

Partial / multi-chit payment, invoice-aware lift capacity math, and gating a chit against invoice
expiry at insert are all explicitly out of scope and remain future `feat-` work.
