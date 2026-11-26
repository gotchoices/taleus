/**
 * The discovery-simulation tier: wiring that runs the real `tallynet` route-discovery protocol over a
 * simulated tally {@link Network} on compressed, deterministic time, so a payment search behaves as it
 * would on a live network (each node's own view of its tally capacity, plus latency, dropped messages and
 * sleeping nodes) and finds only routes the all-seeing oracle agrees exist. See `docs/design.md`
 * § Discovery simulation.
 *
 * - `naming.ts` — the node↔entity bijection and the tally→link-id naming shared by harness and conditions.
 * - `well-known.ts` — derive the well-known (high-degree) entities, and build a run's referee nominations.
 * - `terms.ts` — the discovery link-term type and the capacity-aware node policy (the correctness anchor).
 * - `conditions.ts` — compile a declarative conditions spec into the harness's per-link condition map.
 * - `identity.ts` — the deterministic signer/verifier layer that gives consensus nodes reproducible keys.
 * - `consensus-resource.ts` — failure-injecting consensus resource ports (keyed by entity id) for tests.
 * - `harness.ts` — build a running discovery (and optionally consensus) network from a `Network`.
 * - `plan-select.ts` — the originator's plan-selection policy (shortest-path) over a query's found plans.
 * - `route.ts` — invert a chosen plan's anonymised nonces back to the concrete tally route it walks.
 * - `consensus-harness.ts` — drive one found plan through the real sign-and-settle lift; move money on commit.
 * - `trace-format.ts` — the versioned NDJSON trace-line union, `serializeTraceLine` and `parseTrace`.
 * - `trace-writer.ts` — `makeTraceWriter`: stream a header + network + per-event lines to a `LineSink`.
 * - `protocol-metrics.ts` — pure measurement: trace + outcome + oracle verdict → per-query / per-run metrics.
 * - `consensus-metrics.ts` — pure measurement: consensus trace + lift result → per-lift / per-run commit metrics.
 * - `sim-runner.ts` — the discovery sweep runner (mirrors `runner.ts`): one record per (cell × seed).
 * - `consensus-runner.ts` — the sequential consensus sweep runner: one commit-metrics record per (cell × seed).
 */

export * from './naming.js'
export * from './well-known.js'
export * from './terms.js'
export * from './conditions.js'
export * from './identity.js'
export * from './consensus-resource.js'
export * from './harness.js'
export * from './plan-select.js'
export * from './route.js'
export * from './consensus-harness.js'
export * from './consensus-metrics.js'
export * from './trace-format.js'
export * from './trace-writer.js'
export * from './protocol-metrics.js'
export * from './sim-runner.js'
export * from './consensus-runner.js'
