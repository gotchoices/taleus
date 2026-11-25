/**
 * Public surface of the `tallynet/testing` subpath export: the in-memory network harness the
 * simulator and viewer build on -- a virtual clock, a seeded random source, and a wired graph of
 * discovery nodes. This is a **shipped** module behind its own subpath export, not a private test
 * file; it is deliberately kept out of the main `src/index.ts` barrel so hosts pull it only when they
 * want the harness. Anything simulator-specific lives in `tallysim`, not here.
 */

export * from './clock.js'
export * from './random.js'
export * from './network.js'
