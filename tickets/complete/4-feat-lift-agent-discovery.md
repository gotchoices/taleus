description: The route-finding half of the lift agent — given "pay X to this person", it searches the credit graph for a path, converts the amount through each currency boundary along the way, and reports the exact source-currency cost before anything is committed.
files: src/lift/terms.ts, src/lift/discovery.ts, src/lift/agent.ts, src/lift/index.ts, src/lift/test-harness.ts, src/lift/terms.test.ts, src/lift/discovery.test.ts, src/lift/agent.test.ts, src/index.ts, docs/architecture.md (§ Denomination-aware discovery)
----

## What landed

Denomination-aware route-discovery adapter, per `docs/architecture.md` § *Denomination-aware discovery* / § *Cross-denomination conversion*. Drives ChipNet's **unidirectional** search toward a payee (payment) or back to self (circular clearing lift), fills the `L`/`C` intent terms + negotiate callbacks, accumulates the backward conversion product + composed trading-variable fee, and stops at "route selected, cost known, **not yet pledged**". Pledge/commit is the next ticket (`feat-lift-referee-commit`), which consumes the `LiftPlan` defined here.

- **`src/lift/terms.ts`** — `L`/`C` intent-term shapes + population from three injected ports (`TallyContract` denom/scale, `LiftLading` reserved-balance capacity/fee, private `ExchangeRateQuote`). Handoff structs `LiftPlan`/`RouteEdge`/`SourceCost`/`RefereeSlot`.
- **`src/lift/discovery.ts`** — pure backward accumulator (`accumulateRoute`): one `convertBoundary` ceiling per boundary, composed fee `1 − Π(1 − MyRate)`, prune surface (missing/expired quote, zero/insufficient capacity — none throw). Negotiate callbacks + `selectRoute`.
- **`src/lift/agent.ts`** — driver (`LiftAgent`): query → collect → select cheapest viable → surface source cost → journal each phase. `LiftJournalOriginatorState` over portfolio `LiftJournal`, correlated strictly by `liftId`. ChipNet search is an injected `DiscoveryEngine` port.
- **`src/lift/test-harness.ts`** — in-memory doubles; excluded from production build.

`yarn build` / `yarn lint` clean; `yarn test` green — **70 tests, 7 suites** (32 new).

## Review findings

Adversarial pass over the implement diff (`017e91b`), read before the handoff. Scrutinized: conversion-product math, fee composition, prune surface, direction invariant, selection policy, journal/concurrency correlation, port boundaries, docs, type safety, resource cleanup. Result: implementation is solid and matches the design docs and `LiftLading`/`convert.ts` contracts. One latent issue found and parked as a tripwire; no code defects, no new tickets.

**Verified correct (checked, nothing found):**
- **Conversion product** — hand-recomputed the two/three-denom chains (both directions), ceiling-per-boundary, dust-to-originator, single-denom degeneracy (no rate lookup where denoms match). Matches `convertBoundary`'s own numbers.
- **Fee composition** — `1 − Π(1 − MyRate)` is unit-independent (per-edge `units` cancel in num/den), composes multiplicatively, reward applies only above `freeUnits`, negative subsidy permitted. Numeric checks agree with the tests.
- **Prune surface** — missing-quote / zero-capacity / insufficient-capacity each return (never throw); mis-directed boundary quote throws (programming error, by design — the spread-inversion guard the exchange-rate-quotes review caught).
- **Journal / concurrency** — monotonic revisions, `current` = highest revision per `liftId`, two lifts on one store do not cross-contaminate. Correlation is strictly `liftId`-keyed.
- **Docs** — `docs/architecture.md` § Denomination-aware discovery updated with the landed `src/lift/` map; accurate.
- **Build/lint/test** — all clean; 70/70 tests pass. No `.pre-existing-error.md` written; `.pre-existing-known.md` empty — no pre-existing failures surfaced.

**Found — parked as tripwire (NOTE at site, not a ticket):**
- **`selectRoute` compares `sourceUnits` as a raw integer across candidates**, which assumes every candidate originates on the same source denomination. True today (a payment originates on the payer's single chosen tally, and the injected engine produces single-origin-denom candidates). If discovery ever returns candidates that originate on tallies of *different* denominations (payer holds heterogeneous outbound tallies), comparing their `sourceUnits` by `<` is meaningless and picks the wrong route — selection would then need a common valuation across source denoms. Conditional on multi-denom origination, which is not reachable with the current single-origin flow / injected engine → recorded as a `NOTE:` at `selectRoute` in `src/lift/discovery.ts`, not filed as a ticket. Folds naturally into the already-flagged "selection policy is a v1 heuristic; reconsider if route quality matters beyond cost" reconsideration.

**Minor test gaps noted, not worth fixing this pass** (implementer's suite is a thorough floor): same-denomination-different-scale boundary (code path exists via `convertBoundary`'s scale handling, exercised only through cross-denom cases); `insufficient-capacity` at a non-zero edge index (simple loop, covered at edge 0); `mathEdge` production projection (trivial field copy, untested — it is the not-yet-bound adapter seam). None affect correctness.

**Design calls confirmed (the implementer asked the reviewer to sanity-check these — all judged sound for this ticket's scope):**
- Fee is a **comparison/disclosure metric**, not folded into settled per-edge units (those come purely from the conversion product) — the commit ticket finalizes fee-to-units mechanics; `composeFeePpm` is the single site to change. Sound; matches the "source cost = accumulated `req_in`" test contract.
- `no-CreditTerms` folded into `zero-capacity` (0 limit → 0 movable units → same reason code). Sound.
- ChipNet unbound; `DiscoveryEngine` + discovery types are a local port. Sound and consistent with `feat-chipnet-transport`. The one thing for the **binding ticket** to weigh: `accumulateRoute` takes all edges + all quotes at once (global assembly), whereas a real distributed search folds per-node so no node sees another's private quote — the pure reference accumulator and the distributed callback contract must be reconciled when ChipNet lands. Not a defect here (documented port boundary); called out so the binding ticket does not miss it.

## Empty categories

- **Major findings → new tickets:** none. No correctness defect reachable under the current bound; the one latent concern is genuinely conditional (multi-denom origination) and parked as a tripwire per the rules.
- **Minor findings → fixed inline:** one — the `selectRoute` NOTE (a comment; the demoted-tripwire disposition, not a behavioral fix).
- **Pre-existing failures:** none surfaced.

## Tripwires parked (from implement, still valid)

- **Wire serialization of `bigint`** — `NOTE:` at top of `terms.ts`; string-encode at transport body when the real engine sends these terms.
- **Fee-model fidelity** — `NOTE:` at `composeFeePpm` in `discovery.ts`.
- **Rounding-dust over long routes** — pre-existing `NOTE:` in `schema/portfolio.qsql`.
- **(New, this review) cross-denomination source-cost comparison** — `NOTE:` at `selectRoute` in `discovery.ts`.
