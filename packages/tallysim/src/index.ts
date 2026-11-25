/**
 * TallySim: the Taleus tally-network simulator. See docs/design.md.
 *
 * This barrel ships the network-model tier: the plain, serialisable network data model
 * (`model.ts`), the directed-capacity model (`capacity.ts`), the capacity/balance distributions
 * (`distributions.ts`), the four seeded network generators (`generators/`), and the pure structural
 * graph utilities (`structure.ts`). The whole-graph oracle and the experiment runner are later tickets.
 */

export * from './model.js'
export * from './capacity.js'
export * from './distributions.js'
export * from './structure.js'
export * from './generators/index.js'
