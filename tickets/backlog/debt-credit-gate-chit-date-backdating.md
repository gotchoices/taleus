description: A party can dodge a credit-limit reduction by dating a payment as if it were signed before the reduction took effect — decide how to stop that.
prereq:
files: schema/draft1.qsql
difficulty: medium
----
## Problem

The credit gate (`Ledger.WithinCreditLimits`, `schema/draft1.qsql`) decides how much a
party may owe by looking up the credit limit **in force as of the chit's own signed
`Date`**. That date was chosen deliberately to keep the check deterministic (no `now()`),
but it is asserted by the party issuing the chit and is otherwise unconstrained:

- Nothing ties a chit's `Date` to its `Number` (no date-vs-sequence monotonicity), so a
  chit can carry any valid past date.
- Chits are **unilateral** — signed only by the issuer, never countersigned by the
  counterparty. So this CHECK constraint is the *only* thing that can reject an
  over-limit chit; there is no separate "the other party refused to accept it" step.

Together these let an issuer **backdate a chit** to a date before a restrictive credit
reduction took effect, causing the gate to pick the older, higher limit and admit a
balance that exceeds the limit now in force. This defeats the whole point of the
notice/`CallDays` mechanism: a grantor gives notice before lowering how much it will let
the counterparty owe, but the counterparty (or the grantor, symmetrically) can keep
running the balance up against the pre-reduction limit by simply dating chits earlier.

This is distinct from the already-recorded grantor-backdating caveat on the `CreditTerms`
table (a grantor backdating *its own terms* `Date`) — that one is disputable because both
parties observe the signed terms date. Here the victim has no schema-level recourse: the
constraint passes and the chit commits into the shared strand.

## Why this is a design decision, not a mechanical fix

The determinism-vs-safety tradeoff was deliberate. Options, each with a cost:

- **Bound `Date` against `date('now')`** (reject future/too-old dates) — makes chit inserts
  volatile/non-deterministic, the exact thing the current design avoided.
- **Gate on the limit effective *now*** rather than at the chit's date — also volatile, and
  changes the semantics of what "effective" means for a chit.
- **Enforce `Date` monotonic with `Number`** (each chit's date ≥ prior chit's date) — keeps
  determinism, bounds backdating to "no earlier than the last chit," but still allows
  drifting the whole chain's dates and needs a rule for the first chit.
- **Accept it as disputable** — document that backdated chits are visible to both parties
  and resolved out-of-band (weakest; the counterparty cannot reject a unilateral chit at
  signature time, so "disputable" has less teeth here than for terms).

Pick the semantics MyCHIPs intends for chit dating and credit enforcement, then implement.
No runner exists yet (design-phase schema, no `package.json`), so this cannot be executed
or tested here — capture the decision and the constraint change.

A `NOTE:` marker sits at the `WithinCreditLimits` constraint pointing back to this ticket.
