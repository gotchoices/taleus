description: The route-finding half of the lift agent — given "pay X to this person", it searches the credit graph for a path, converts the amount through each currency boundary along the way, and reports the exact source-currency cost before anything is committed.
files: src/lift/terms.ts, src/lift/discovery.ts, src/lift/agent.ts, src/lift/index.ts, src/lift/test-harness.ts, src/lift/terms.test.ts, src/lift/discovery.test.ts, src/lift/agent.test.ts, src/index.ts, docs/architecture.md (§ Denomination-aware discovery)
----

## What landed

The denomination-aware route-discovery adapter, per `docs/architecture.md` § *Denomination-aware discovery* and § *Cross-denomination conversion*. It drives ChipNet's **unidirectional** search (bidirectional is unimplemented upstream) toward a payee (payment) or back to self (circular clearing lift), fills the `L`/`C` intent terms and negotiate callbacks so a discovered route carries denomination, capacity, fee, and the accumulated cross-denomination conversion, and stops at "route selected, cost known, **not yet pledged**". Pledge/commit is the next ticket (`feat-lift-referee-commit`), which consumes the `LiftPlan` defined here.

- **`src/lift/terms.ts`** — `L`/`C` intent-term shapes and their population from three injected data-source ports: the edge's `TallyContract` (denom + scale), the strand's `LiftLading` view (movable capacity + fee, **off the reserved balance** so an open pledge already shrinks it), and the party's private `ExchangeRateQuote` (the boundary quote, read locally, never shared). Also the handoff structs `LiftPlan`/`RouteEdge`/`SourceCost`/`RefereeSlot` the commit ticket consumes.
- **`src/lift/discovery.ts`** — the **pure** backward accumulator (`accumulateRoute`): one `convertBoundary` ceiling per boundary (conversion product → per-edge ceiled units + source cost), the composed trading-variable fee (`1 − Π(1 − MyRate)`), and the prune surface (missing/expired quote, zero capacity, insufficient capacity) — none of which throws. Plus the negotiate callbacks (`makeNegotiateCallbacks`) and route selection (`selectRoute`).
- **`src/lift/agent.ts`** — the driver (`LiftAgent`): kick off a query, collect candidates, select the cheapest viable, surface the exact source cost, journal each phase. `LiftJournalOriginatorState` backs ChipNet's originator-state interface with the portfolio `LiftJournal` (correlated strictly by `liftId`). The ChipNet search itself is an injected `DiscoveryEngine` port.
- **`src/lift/test-harness.ts`** — in-memory doubles (scripted engine, journal store, stub term source, edge builders); excluded from the production build.
- Re-exported via `src/lift/index.ts` → `src/index.ts`.

`yarn build` / `yarn lint` clean; `yarn test` green — **70 tests, 7 suites** (32 new here: `terms.test.ts`, `discovery.test.ts`, `agent.test.ts`).

## How to validate

- `yarn test 2>&1 | tee /tmp/t.log` — full suite. Lift-specific: `yarn test src/lift`.
- `yarn build` and `yarn lint` — both silent = clean.

Use cases exercised (the reviewer should treat these as the floor, not the ceiling):

- **Two-denomination payment** — USD(scale 2) → CHIP(scale 3), quote 2 USD/CHIP: 1.5 CHIP (1500 milliCHIP) costs exactly 300 cents; the presented source cost **equals** `perEdgeUnits[0]` (the accumulated `req_in` at the originator's edge), dust upstream.
- **Three-denomination chain, both directions** — A→B→C and C→B→A, per-edge ceiled units verified against the conversion-helper's own numbers.
- **Single-denomination circular clearing lift** — degenerate: all rates 1, ceiling a no-op, MyCHIPs-equal; asserts **no rate lookup happens** where denominations match (bogus quotes that would throw the direction assert are proven un-consulted).
- **Pruned by missing quote** / **pruned by zero reserved capacity** / **insufficient capacity** — each returns a prune (never throws) and never appears as the selected candidate.
- **Sleeping edge** — a non-responding route is skipped without failing the round; a live route is still selected; a round whose only route sleeps is empty, not an error.
- **Concurrent discovery** — two lifts on one shared journal store correlate strictly by `liftId`; accumulated products and journal edges do not cross-contaminate.
- **Backward-direction invariant** — a mis-directed boundary quote (`From`/`To` swapped) throws (programming error), not a prune — the guard against the exact spread-inversion bug the exchange-rate-quotes review caught.
- **Fee composition** — single clutch, two clutches composing multiplicatively (not additively), reward on the rewarded portion only, and a negative (subsidy) fee.

## Known gaps & things to scrutinize (honest — treat my tests as a floor)

- **ChipNet is not bound; the search engine is a port.** `chipnet`/`chipcryptbase` remain unpublished (`blocked/chipnet-npm-publish-needed`), and bidirectional search is unimplemented upstream anyway, so — exactly as `feat-chipnet-transport` did for the wire types — the discovery-side ChipNet types are a **local port** and `DiscoveryEngine` is injected. **What is therefore NOT exercised against a real ChipNet:** the actual multi-hop topology walk, query-economics depth/cost cut-offs, the real time-budget skip of a sleeping edge, and late-response folding beyond the scripted double. The *accumulation, pruning, selection, costing, and journaling* are fully bound and tested; the *search* is simulated. This is the biggest thing to weigh — is the port surface right, and is the accumulator the correct contract for the real engine to call?
- **The fee model is the softest design call.** `composeFeePpm` reads each edge's `MyRate` as `clutch` on the whole amount + `reward` on the rewarded portion (units above `freeUnits`), composed via the `LiftLading` rule. This is a reasonable reading of the free/rewarded split, but the precise MyCHIPs fee-to-units mechanics are the **commit ticket's** to finalize. Deliberate decision recorded at the site: the fee here is a **comparison/disclosure metric**, *not* folded into the settled per-edge units — those come purely from the conversion product (which is what the "source cost = accumulated `req_in`" test contract asserts). If commit needs the fee to move units, `composeFeePpm` is the single site to change. Please sanity-check this split.
- **`no-CreditTerms` is folded into `zero-capacity`.** The ticket lists it as an independent prune; a party with no `CreditTerms` advertises a 0 limit → `LiftLading` yields 0 movable units → `zero-capacity`. Same outcome, one reason code. Documented at the prune site.
- **`selectRoute` policy is a v1 heuristic** — cheapest source cost, then lowest fee, then fewest edges. No reliability/depth weighting yet; reconsider if route quality matters beyond cost.
- **The `LiftPlan` handoff** carries per-edge `units` (ceiled, own denomination), `nonce`, and — for owned edges only — `linkId`/`issuer` (privacy: non-owned edges are nonces only; each participant fills its own `issuer` at pledge time). `referee` defaults to the caller-supplied `RefereeSlot` (reference default: the originator's own agent); **referee acceptance in ChipNet's promise phase is the commit ticket's**, not enforced here.

## Tripwires parked (NOTE at site — not filed as tickets)

- **Wire serialization of `bigint`.** `LiftTerms`/`RateQuote` carry `bigint` capacities/units for exactness. ChipNet JSON-frames terms (`src/transport/comms.ts`), and `JSON.stringify` throws on a `bigint`, so when the real engine lands these must be string-encoded at the transport body boundary and parsed back. No live engine sends these terms today, so the encode/decode shim is deferred. `NOTE:` at the top of `terms.ts`.
- **Fee-model fidelity** (above) — `NOTE:` at `composeFeePpm` in `discovery.ts`.
- **Rounding-dust accumulation over long routes** — pre-existing `NOTE:` in `schema/portfolio.qsql`; a route of N boundaries adds up to N sub-units of originator cost, bounded/acceptable now.

## Empty categories

No pre-existing test failures surfaced (nothing written to `.pre-existing-error.md`; `.pre-existing-known.md` is empty). No new fix/plan/backlog tickets warranted from the implement pass — the open items are design calls for the reviewer to confirm and tripwires parked at their sites, not new work.
