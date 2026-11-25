/**
 * TallySim: the Taleus tally-network simulator. See docs/design.md.
 *
 * This barrel ships the network-model tier and the oracle: the plain, serialisable network data model
 * (`model.ts`), the directed-capacity model (`capacity.ts`), the capacity/balance distributions
 * (`distributions.ts`), the four seeded network generators (`generators/`), the pure structural graph
 * utilities (`structure.ts`), the compiled directed-capacity graph view (`graph-view.ts`), and the
 * whole-graph oracle (`oracle.ts`), and the experiment harness: the scenario/sweep model (`scenario.ts`),
 * the sweep runner (`runner.ts`), the metric aggregation (`metrics.ts`), and the output serialisers
 * (`serialize-records.ts`). The Node-only CLI (`cli/`) is deliberately **not** exported here — it is the
 * one platform-specific file and ships separately.
 */

export * from './model.js'
export * from './capacity.js'
export * from './distributions.js'
export * from './structure.js'
export * from './generators/index.js'
export * from './graph-view.js'
export * from './oracle.js'
export * from './scenario.js'
export * from './metrics.js'
export * from './runner.js'
export * from './serialize-records.js'
