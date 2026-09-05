/**
 * Data layer switches — the one place that decides where tally state comes from.
 *
 * Mode A — mock (USE_ENGINE = false)
 *   Adapters read `mock/data/<namespace>.<variant>.json`. No engine, no storage,
 *   no network. This is what design and scenario capture run against.
 *
 * Mode B — engine on a local store (USE_ENGINE = true, USE_CADRE = false)
 *   The taleus engine over a local database: one device, no peers.
 *
 * Mode C — engine in a cadre (USE_ENGINE = true, USE_CADRE = true)
 *   The engine over the embedded cadre node: real strands, peers, lifts.
 *
 * Screens and components check neither of these. They call the adapters in
 * `src/data/`, which is the only code that knows the difference. See
 * `design/specs/domain/interfaces.md` § Run modes.
 */
export const USE_ENGINE = false
export const USE_CADRE = false

/** True when adapters should serve fixtures rather than engine state. */
export const mockMode = !USE_ENGINE
