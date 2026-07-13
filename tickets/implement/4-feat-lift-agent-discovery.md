----
description: Build the lift agent's route-finding: use ChipNet to search the tally graph for a payment/lift path, carrying each hop's currency, capacity, and exchange rate, and report the exact source-currency cost before anything is committed.
prereq: feat-chipnet-transport, feat-lift-conversion-helper
files: src/lift/agent.ts (new), src/lift/discovery.ts (new), src/lift/terms.ts (new), schema/draft1.qsql (LiftLading, ReservedBalance views), schema/portfolio.qsql (LiftJournal, ExchangeRateQuote), docs/architecture.md (§ Denomination-aware discovery, § State mapping)
difficulty: hard
----

The route-discovery half of the lift agent. Drives ChipNet's **unidirectional** search (bidirectional is not implemented upstream — see docs) over `/taleus/chipnet/1.0.0`, filling the `L`/`C` intent terms and negotiate callbacks so a discovered route carries denomination, capacity, fee, and the accumulated cross-denomination conversion. Stops at a chosen route with its exact source-denomination cost. Commit is the **next** ticket (`feat-lift-referee-commit`); this ticket ends at "route selected, cost known, not yet pledged."

## What to build

- **Intent terms (`src/lift/terms.ts`).** Populate each `L`-intent link's opaque `Terms` for a hop: **denomination + scale** (from the edge's `TallyContract`), **movable capacity + fee** (from the strand's `LiftLading` view — computed off the *reserved* balance, so an open pledge already shrinks it), and the intermediary's **exchange-rate quote** for the boundary it straddles (its private `ExchangeRateQuote`, read locally, never shared). `C`-only links carry comms terms.
- **Negotiate callbacks (`src/lift/discovery.ts`).** `NegotiateIntentFunc` / `NegotiatePlanFunc` that (a) accept/reject a hop against the query, and (b) accumulate the **conversion product** backward from the payee using `feat-lift-conversion-helper`'s `req_in` at each boundary, composing trading-variable fees per the `LiftLading` rule alongside the conversion. A boundary with a missing/expired quote **prunes** the route (never fabricate a rate).
- **Agent driver (`src/lift/agent.ts`).** Kick off a unidirectional query from the originator toward the payee (payment) or back to self (circular clearing lift); collect candidate `Plan`s; select one; surface the exact **source-denomination cost** (originator absorbs the per-edge rounding dust). Persist discovery/correlation state in the portfolio `LiftJournal` (ChipNet injects all state — back its originator-state interface with `LiftJournal`).

## Edge cases & interactions

- **Backward-from-payee direction.** The amount is specified in the *payee's* denomination; conversion accumulates upstream. Getting the direction wrong inverts every spread (this is the exact bug `feat-exchange-rate-quotes` review caught in the column gloss) — assert `From = D_in` (upstream/received) `, To = D_out` (downstream/released) at each boundary.
- **Capacity from reserved, not settled.** `LiftLading` already advertises from `ReservedBalance`; the agent must not re-add open-pledge effects (double-count). An edge already carrying an open pending lift advertises less — respect it.
- **Missing/expired quote, zero capacity, no `CreditTerms`.** Each independently prunes a route; none should throw. A hop with zero movable units is not a candidate.
- **Degenerate single-denomination lift.** All rates 1, ceiling a no-op — must produce exactly the MyCHIPs result and not invoke any rate lookup where denominations match.
- **Time budget / sleeping edges.** A non-responding edge is skipped by ChipNet's budget; the agent must not treat a partial round as failure, and must fold late responses (transport already returns promptly).
- **Concurrent discovery.** Multiple lifts in flight share the transport and the `LiftJournal`; correlate strictly by `sessionCode`/`LiftId`. Two discoveries must not cross-contaminate accumulated products.
- **Privacy.** The agent sees only nonces for non-owned edges; it must select and cost a route without ever resolving another party's tally identities.
- **Query economics / max depth.** Respect ChipNet's depth and cost cut-offs; do not force over-searching once a satisfactory route is found (the "unsatisfied originator" pathology in `doc/discovery.md`).
- **Handoff to commit.** The selected `Plan` (topology + per-edge ceiled units in each edge's own denomination + chosen referee slot) is the input `feat-lift-referee-commit` consumes; define that structure here so it is not re-derived.

## Key tests

Two-denomination payment (source cost correct, dust upstream) · three-denomination chain both directions · single-denomination circular clearing lift (degenerate, MyCHIPs-equal) · a route pruned by a missing quote · a route pruned by zero reserved capacity · a sleeping edge skipped without failing the round. Expected outputs: the presented source cost equals the accumulated `req_in` at the originator's edge; pruned routes never appear as candidates.

## TODO

- Implement `src/lift/terms.ts` (L/C term population from `TallyContract`, `LiftLading`, `ExchangeRateQuote`).
- Implement `src/lift/discovery.ts` negotiate callbacks with backward conversion-product accumulation via the conversion helper + fee composition + quote-prune.
- Implement `src/lift/agent.ts` unidirectional driver, `LiftJournal`-backed originator state, route selection, source-cost surfacing.
- Tests per the floor above; `yarn test` green (stream with `tee`).
