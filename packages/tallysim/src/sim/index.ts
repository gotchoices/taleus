/**
 * The discovery-simulation tier: wiring that runs the real `tallynet` route-discovery protocol over a
 * simulated tally {@link Network} on compressed, deterministic time, so a payment search behaves as it
 * would on a live network (each node's own view of its tally capacity, plus latency, dropped messages and
 * sleeping nodes) and finds only routes the all-seeing oracle agrees exist. See `docs/design.md`
 * § Discovery simulation.
 *
 * - `naming.ts` — the node↔entity bijection and the tally→link-id naming shared by harness and conditions.
 * - `terms.ts` — the discovery link-term type and the capacity-aware node policy (the correctness anchor).
 * - `conditions.ts` — compile a declarative conditions spec into the harness's per-link condition map.
 * - `harness.ts` — build a running discovery network from a `Network` and run one payment query.
 */

export * from './naming.js'
export * from './terms.js'
export * from './conditions.js'
export * from './harness.js'
