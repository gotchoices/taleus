/**
 * Internal surface of the consensus module: the record data model, the canonical signed preimage, the
 * sign/verify primitives and the durable store. The file layout under `consensus/` is internal; the
 * state machine (next ticket), hosts and tests import from here.
 *
 * Deliberately **not** re-exported from `../index.js` yet: the public barrel ships with the final
 * `tallynet-consensus` ticket so the consensus surface lands atomically with a working state machine.
 */

export * from './types.js'
export * from './digest.js'
export * from './signature.js'
export * from './store.js'
export * from './resource.js'
export * from './participant.js'
