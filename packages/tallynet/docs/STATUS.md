# TallyNet status and sequence

Where TallyNet and its simulator stand, and the order the remaining work follows. Design lives in [design.md](design.md); the work itself lives in `tickets/` (slugs below). This file records the **sequence** and why.

## Strategy: protocol first, bind once

TallyNet is developed, tested and measured on its own, with `tallysim` and `tallysim-viewer`, before `taleus-core` changes to use it. Reasons:

- The protocol is still moving (voter model, record availability, timeouts, hostile peers). Iterating inside one package is cheap; every change after binding also ripples into `taleus-core`'s adapters and schema.
- The voter model decides what each tally's schema must verify. Binding first would build in the legacy single-referee shape only to replace it.
- Simulation supplies the defaults (depth, time budget, voter policy, timeouts) from measurement.

`taleus-core` is bound once, against the settled protocol, with voter sets from the start. The cost of waiting: end-to-end lifts in the apps stay mocked until then. The risk: mismatches that only show at integration. Keep [design.md](design.md) § The seam taleus-core already defines current, and treat "what a tally must verify" (from the voter model) as the binding contract.

## Built

- **Shared pieces**: crypto ports, self-expiring session codes, nonces, canonical digest (DAG-CBOR), step sequencing, rule engine; `Clock` and `TraceSink` ports; `tallynet/testing` (virtual clock, in-memory network, seeded random).
- **Discovery**: unidirectional search, one round per level (depth limit = hops), durable/in-flight state split, hop-context hooks for multiple currencies (default single-currency behaviour).
- **Consensus**: self-describing record merged by union, promise then vote, strict majority of the voter set both ways, every signature verified, unverified votes held in a capped side pool so they can't block real ones.
- **tallysim**: seeded network generators, whole-graph oracle, sweep runner and CLI, route-existence experiment, the real discovery protocol on simulated time with replayable traces and found-vs-oracle metrics, discovery experiment; consensus in the simulator (in progress).
- **tallysim-viewer**: graph view, trace replay, live runs in the page, sweep charts; consensus animation (in progress).

## ChipNet regression check (done 2026-11-25)

The feature-by-feature check that the rewrite kept everything ChipNet got right is in [chipnet-review.md § Regression check](chipnet-review.md#regression-check-tallynet-vs-chipnet-feature-by-feature). Outcome: **no correctness regression** — discovery and consensus are a faithful superset, improved on every known-defect axis. It turned up:
- **One minor silent regression** — ChipNet saved an inbound peer record before processing, suppressing an echo of an unchanged record back to its sender; TallyNet lost that. Ticket `bug-tallynet-push-echo-suppression` (fix/).
- **Designed-but-unbuilt features no ticket owned** — target-signature verification + "whispering" identity checks (`feat-tallynet-identity-verification`), and discovery path/address caching (`feat-tallynet-discovery-caching`), both new in backlog. Everything else ChipNet only designed is already owned by a step above (voter model, propagation timeouts, hostile actors, query economics, bidirectional, adaptive budget).
- **Test-coverage gaps** — no 10k-node discovery run and no mixed-intent (`C`) route test: `debt-tallynet-discovery-scale-intent-tests` (backlog).
- **Design-question inputs** for the next step (plan→topology voter-set assembly and its end-to-end test; record availability around a non-cooperating member; equivocation "proof kept" is still aspirational) were recorded in `tallynet-voter-model` and are now resolved in design.md § Lift proposal and settlement: plan→topology minting + its end-to-end test is `tallynet-originator-proceed`; record availability (pull + contact points) and equivocation proof are `tallynet-record-availability`.

## Sequence

| # | Step | Ticket(s) |
|---|---|---|
| 1 | Finish consensus in the simulator and viewer | `tallysim-consensus-*`, `tallysim-viewer-consensus` |
| 2 | Make the simulator's virtual clock drain robustly | `debt-tallynet-virtual-clock-drain` |
| 3 | Regression check against ChipNet, feature by feature | `tallynet-chipnet-regression` |
| 4 | Voter model, proposal parameters, record availability (principles 0–4 in design.md § Lift design principles; decisions in § Lift proposal and settlement) | `tallynet-terms-and-proposal-params` → `tallynet-lift-policy-hooks` → `tallynet-originator-proceed` → `tallynet-record-availability`; sim `tallysim-voter-model` → `tallysim-viewer-voter-model` |
| 5 | Liveness: pre-promise void, voter timeouts, stalled-lift recovery | `tallynet-propagation-timeouts` |
| 6 | Hostile actors in the simulator | `tallysim-hostile-actors` |
| 7 | Reputation, evidence and expulsion policy (brainstorm first) | `feat-tallynet-hostile-peers` |
| 8 | Trading model: balances that build up and drain over time (brainstorm first) | `feat-tallysim-trading-model` |
| 9 | Multiple currencies in the simulator | `feat-tallysim-multi-denomination` |
| 10 | Bind `taleus-core`, voter sets from the start; rename ChipNet → TallyNet | `feat-tallynet-bind-taleus-core` |
| 11 | Real multi-currency lifts through Taleus | `feat-tallynet-multi-denomination` |
| 12 | Taleus-level simulation tier (real lift rules on in-process strands) | `feat-tallysim-taleus-tier` |

Steps 6–9 can overlap. Other deferred protocol features stay in backlog until a step needs them: `feat-tallysim-clearing-discovery`, `feat-tallynet-adaptive-budget`, `feat-tallynet-bidirectional-search`, `feat-tallynet-routing-hints`, `feat-tallynet-trust-query`, `feat-tallynet-lift-identity-options`, `debt-tallynet-query-economics`.

## Research question

How complex must a tally network become before lift payments become statistically likely? First answers (route existence, no trading yet) are in `packages/tallysim/docs/design.md` § First experiment. A fuller answer needs the trading model (step 8) and the hostile-actor results (step 6).
