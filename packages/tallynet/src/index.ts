/**
 * TallyNet: the lift protocol library for Taleus — route discovery across the tally graph and
 * atomic promise/commit of a lift across many tally strands. A port of ChipNet. See docs/design.md.
 *
 * This barrel ships the shared building blocks — the crypto ports, self-expiring session codes, edge
 * nonces, the canonical digest, step sequencing, and the rule engine — plus the full route-discovery
 * engine (`discovery/`). The consensus engine remains a later ticket.
 */

export * from './clock.js'
export * from './trace.js'
export * from './crypto.js'
export * from './session-code.js'
export * from './nonce.js'
export * from './digest.js'
export * from './sequencing.js'
export * from './rule.js'
export * from './discovery/index.js'
