description: Restore MyCHIPs' rich credit terms (interest, compounding period, grace, minimum payment, prepayment cap, maturity/vesting) that were collapsed to a bare limit+call in the Taleus reboot, so the platform can represent more than demand, short-term credit.
prereq: feat-schema-credit-terms
files: packages/taleus/schema/draft1.qsql, docs/drafts/credit-terms.md
difficulty: hard
----
## Why this ticket exists

This is a **committed regression fix**, not an open "should we?" question. MyCHIPs represented credit
terms with a rich key set (`rate`, `period`, `grace`, `mort`, `pay`, `defint`, plus `limit`/`call`); the
Taleus reboot collapsed `CreditTerms` to **`CreditLimit` + `CallDays` + opaque `Args`**, which reduces the
model to demand credit lines. Interest-bearing loans, amortizing debt, and term instruments — the bulk of
real private credit — have no first-class representation. The project intends to **enable all imaginable
contracts and let regulators sort out legality**, so restoring rich terms is in scope, not deferred on
principle.

Maturity/**vesting** (a date before which credit is not liquid) is folded in here as the same
"enable term instruments" goal. Note it was an *unimplemented TODO* in MyCHIPs, so it is a new feature
rather than a strict regression, but it belongs with this work.

## Design space

The full design exploration — what to cover, the constraints (unilateral/grantor-signed, revisioned,
insert-only, notice-delayed restrictive changes), and the open questions (how much to machine-enforce, the
accrual mechanism, lift-economics interaction, structured columns vs. typed JSON) — lives in
[`docs/drafts/credit-terms.md`](../../docs/drafts/credit-terms.md). Resolve those before writing schema.

## Acceptance constraints (whatever shape is chosen)

- **Unilateral, grantor-signed, revisioned, insert-only** — same house style as `CreditTerms` /
  `TradingVariable`. The bilateral denomination stays separate on `TallyContract`.
- **Notice-delayed restrictive changes** — the existing `CallDays` / `EffectiveDate` mechanism must extend
  to the richer terms, not be bypassed.
- **Deterministic gate** — any credit gate that computes an accruing/amortizing limit must stay
  deterministic (no `now()` in a CHECK; keep chit-date keying, per the schema's volatility caveats).
- **No half-baked parser** (house rule) — either a real bounded evaluator or contract-interpreted
  structured data; no ad-hoc formula parsing.

## Decompose on promotion

When planned, likely splits into (at least): a rich-terms `CreditTerms` extension, an accrual/interest
mechanism, and a chit-level maturity/vesting gate. Promote from backlog once the design-doc open questions
are decided.
