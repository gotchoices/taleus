/**
 * Internal surface of the consensus module: the record data model, the canonical signed preimage, the
 * sign/verify primitives, the durable store, the host resource port, the participant state machine and
 * the per-node {@link ConsensusNode} bundle. The file layout under `consensus/` is internal; hosts and
 * tests import from here, and `../index.js` re-exports it so the consensus surface is public.
 */

export * from './types.js'
export * from './digest.js'
export * from './signature.js'
export * from './store.js'
export * from './resource.js'
export * from './participant.js'
export * from './engine.js'
