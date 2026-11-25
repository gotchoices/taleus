/**
 * Public surface of the unidirectional discovery engine. The file layout under `discovery/` is
 * internal; the engine, hosts and tests import from here (re-exported in turn by `../index.js`).
 */

export * from './types.js'
export * from './hooks.js'
export * from './store.js'
export * from './participant.js'
// `originator.ts` owns `DiscoveryResult`; `engine.ts` only *imports* it (does not re-export), so these
// two `export *`s do not double-export it. The originator loop + the per-node bundle complete the surface.
export * from './originator.js'
export * from './engine.js'
