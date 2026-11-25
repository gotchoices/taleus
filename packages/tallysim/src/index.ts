/**
 * TallySim: the Taleus tally-network simulator. See docs/design.md.
 *
 * This barrel ships the network-model tier and the oracle: the plain, serialisable network data model
 * (`model.ts`), the directed-capacity model (`capacity.ts`), the capacity/balance distributions
 * (`distributions.ts`), the four seeded network generators (`generators/`), the pure structural graph
 * utilities (`structure.ts`), the compiled directed-capacity graph view (`graph-view.ts`), and the
 * whole-graph oracle (`oracle.ts`). The experiment runner is a later ticket.
 */

export * from './model.js'
export * from './capacity.js'
export * from './distributions.js'
export * from './structure.js'
export * from './generators/index.js'
export * from './graph-view.js'
export * from './oracle.js'
