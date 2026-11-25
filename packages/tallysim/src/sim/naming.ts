/**
 * The single node↔entity bijection, plus the tally→link-id naming, shared by the discovery harness
 * (`harness.ts`) and the network-conditions compiler (`conditions.ts`). It lives in its own tiny module
 * for two reasons: so the harness and the conditions compiler do not import each other (an import cycle),
 * and so there is exactly one documented place that maps a tallysim integer entity id to a `tallynet`
 * node name and back.
 *
 * `entityName` / `entityId` are a total bijection over `0 .. entityCount - 1`: `entityName(id) =
 * String(id)` and its inverse `entityId(name) = Number(name)`. Trace events (which carry a `nodeId`
 * string) and metrics map a node name back to an entity id through `entityId`. `linkIdForTally(i)` names
 * the i-th tally's discovery link (`T0`, `T1`, …); both the harness (building the graph) and the
 * conditions compiler (keying per-link conditions) derive the same id from the same tally index, so the
 * two agree on a link's identity without sharing any state.
 */

/** Entity id → node name. A total bijection over `0 .. entityCount - 1`. */
export const entityName = (id: number): string => String(id)

/** Node name → entity id. The inverse of {@link entityName}. */
export const entityId = (name: string): number => Number(name)

/** The discovery link id for the i-th tally in `network.tallies`. Stable and unique per tally index. */
export const linkIdForTally = (index: number): string => `T${index}`
