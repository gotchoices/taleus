# DRAFT — Rich Credit Terms

> **Status: draft / intention, not settled design.** This records a direction and its rationale so it is
> not lost; it is **not** a spec. The *feature* is committed — tracked in
> [`tickets/backlog/feat-schema-rich-credit-terms.md`](../../tickets/backlog/feat-schema-rich-credit-terms.md);
> the *design* below is still open and must be resolved before that ticket is implemented. Timeless docs
> describe the built system — this describes one we intend to build.

## The gap carried over from MyCHIPs

MyCHIPs represented credit terms as open JSONB (`hold_terms` / `part_terms`) with a documented key set far
richer than today's Taleus schema:

| MyCHIPs key | Meaning |
|---|---|
| `limit` | Maximum balance the debtor may owe (a number **or** a time-based/amortization expression) |
| `call` | Call notice: days the debtor has to pay after a call |
| `rate` | Annualized interest rate |
| `period` | Compounding / payment interval |
| `grace` | Grace period before interest accrues |
| `mort` | Maximum paydown (early-prepayment cap) |
| `pay` | Minimum payment (amount or formula, e.g. `min(10, balance/4)`, `interest`, `balance`) |
| `defint` | Default interest applied after the call period lapses |

Taleus's [`CreditTerms`](../../packages/taleus/schema/draft1.qsql) currently collapses this to
**`CreditLimit` + `CallDays` + opaque `Args`**. That reduces the model to **demand credit lines** —
interest-bearing loans, amortizing debt, and term instruments (the bulk of real private credit) have no
first-class representation. MyCHIPs also had a `vesting` date on chits, designed to represent
longer-term / non-liquid credit, but **never implemented** it.

## Guiding principle

**Let the platform enable all imaginable contracts, and let regulators sort out which ones people may
legally use.** Taleus should not bake in the assumption that credit is short-term and callable-on-demand.
The system is meant to become a private money market for *all* forms of private credit; the terms schema
is where that generality either exists or does not.

## What "rich terms" needs to cover

- **Interest** — a rate, a compounding/accrual `period`, and a `grace` window.
- **Amortization / payment schedule** — a minimum-payment rule (amount or formula) and a maturity.
- **Prepayment limits** — a cap on early paydown (`mort`).
- **Maturity / vesting** — a date before which credit is not liquid (finishing MyCHIPs' abandoned TODO);
  pairs naturally with multi-denomination (e.g. a term note in a `cid:` unit).
- **Default behavior** — what happens when a call period lapses (`defint`).

## Design constraints (must hold whatever the shape)

- **Unilateral and grantor-signed.** Credit terms are policy one party extends to the other; only the
  grantor signs. Same house style as `CreditTerms` / `TradingVariable`: per-party, revisioned,
  insert-only. The bilateral **denomination** stays separate (both sign it, on `TallyContract`).
- **Notice-delayed restrictive changes.** The existing `CallDays` / `EffectiveDate` mechanism (restrictive
  changes take effect only after notice) must extend to the richer terms, not be bypassed by them.
- **Contract-interpreted, not necessarily machine-enforced.** MyCHIPs deliberately did **not** have the
  engine parse or enforce these terms — they are interpreted by reference to the selected contract. Taleus
  can keep that stance (structured data the contract gives meaning to) or add selective enforcement. No
  half-baked parser (house rule): if terms are enforced, use a real, bounded evaluator or keep them as
  contract-interpreted data.

## Open questions (the design pass)

- **How much to machine-enforce.** Options span "structured but inert data the credit gate ignores" →
  "the gate computes an accruing limit from rate/period/grace at chit date." The current `WithinCreditLimits`
  gate is deterministic and chit-date-keyed; an interest-accruing limit must stay deterministic (no `now()`
  in the CHECK — see the volatility caveats already in the schema).
- **Accrual mechanism.** MyCHIPs accrued via periodic chits. Taleus could (a) emit periodic interest chits
  (explicit, auditable, but who signs them?), or (b) compute an accrued balance in a **view** and gate
  against it, or (c) leave accrual entirely to the contract/app. Decide before touching the schema.
- **Interaction with lift economics.** A tally under an amortization schedule or a vesting lock is not
  freely liftable; `LiftLading` and the reserved-credit gates must respect maturity/liquidity. See
  [trading-variables.md](../trading-variables.md).
- **Structured schema vs. typed JSON.** A normalized set of columns (rate, period, grace, …) vs. a
  validated structured `Args`. Normalized is more enforceable; JSON is more open-ended for
  "all imaginable contracts."

## Ticket

The committed work item is [`tickets/backlog/feat-schema-rich-credit-terms.md`](../../tickets/backlog/feat-schema-rich-credit-terms.md)
(rich terms + maturity/vesting in scope). Resolve the open questions above, then promote it from backlog;
on planning it will likely decompose into a rich-terms `CreditTerms` extension, an accrual/interest
mechanism, and a chit-level maturity gate — each carrying the deterministic-gate and unilateral-signing
constraints as acceptance criteria.
