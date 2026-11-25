/**
 * Build a `graphology` graph from a tallysim {@link Network} — the DOM-free, headlessly-testable bridge
 * between the simulator's network model and the sigma renderer. The renderer (`render.ts`) and the layout
 * worker (`layout.ts`) consume the graph this module builds; nothing here touches the browser, so the whole
 * module is unit-tested under jest.
 *
 * ── Conventions (one documented place) ─────────────────────────────────────────────────────────────
 *   - **Node key** is `entityName(id)` — the entity id as a string (`"0"`, `"1"`, …), the same bijection the
 *     trace events and the de-anonymiser use (`tallysim`'s `naming.ts`). A viewer search box therefore looks
 *     a node up by the id the user types, with no extra mapping.
 *   - **Edge key** is `linkIdForTally(index)` (`"T0"`, `"T1"`, …) — the *same* id the discovery link carries,
 *     so the replay ticket can map a decoded tally index straight to a sigma edge key via `edgeKeyForTally`,
 *     with no side table.
 *   - **Edge orientation** is graphology-directed **stock → foil**: `source = entityName(stock)`,
 *     `target = entityName(foil)`. The renderer draws the arrowhead at the target, so an arrow always points
 *     from the stock holder to the foil holder — a fixed, readable encoding of a tally's orientation.
 *
 * ── Multi-edges ────────────────────────────────────────────────────────────────────────────────────
 * Two tallies between the same pair are two distinct edges (the model allows it). A {@link MultiDirectedGraph}
 * with a distinct per-tally edge key keeps them separate; the renderer curves parallel edges apart so they are
 * visually separable. Self-loops (`stock === foil`) are permitted — generators never emit them, but a
 * hand-built network round-trips without throwing.
 *
 * ── Directed capacity ──────────────────────────────────────────────────────────────────────────────
 * Each edge stores both directed capacities verbatim from tallysim's {@link capStockToFoil} /
 * {@link capFoilToStock} — never a formula re-derived here. A direction may be `0` (a valid, expected state —
 * the balance sits at a credit bound) or `Infinity` (an unlimited credit limit). The renderer, not this
 * module, maps those numbers to thickness/colour and gives `Infinity` its own non-saturating style; the model
 * only carries the data.
 */

import { MultiDirectedGraph } from 'graphology'
import { capFoilToStock, capStockToFoil, entityName, linkIdForTally, type Network } from 'tallysim'

/** Attributes stored on each graph node (one per entity). `x`/`y` are seeded/updated by the layout. */
export interface TallyNodeAttributes {
	/** The tallysim entity id this node represents. */
	entityId: number
	/** Display label — the entity id as a string (what the search box matches). */
	label: string
	/** Layout x-coordinate. Initialised to 0; the seeded layout (`layout.ts`) sets the real position. */
	x: number
	/** Layout y-coordinate. Initialised to 0; the seeded layout sets the real position. */
	y: number
}

/** Attributes stored on each graph edge (one per tally). Visual size/colour are the renderer's job, not stored. */
export interface TallyEdgeAttributes {
	/** Index of this tally in `network.tallies` — the stable identity the de-anonymiser resolves a nonce to. */
	tallyIndex: number
	/** Entity id of the stock holder (the edge source). */
	stock: number
	/** Entity id of the foil holder (the edge target; the arrowhead end). */
	foil: number
	/** Directed capacity for value flowing stock → foil (`capStockToFoil`). May be `0` or `Infinity`. */
	capStockToFoil: number
	/** Directed capacity for value flowing foil → stock (`capFoilToStock`). May be `0` or `Infinity`. */
	capFoilToStock: number
}

/** The concrete graphology graph type the renderer and layout operate on. */
export type TallyGraph = MultiDirectedGraph<TallyNodeAttributes, TallyEdgeAttributes>

/** The sigma edge key for the i-th tally — the same id its discovery link carries (`linkIdForTally`). */
export function edgeKeyForTally(index: number): string {
	return linkIdForTally(index)
}

/**
 * Build a {@link TallyGraph} from a {@link Network}: one node per entity (`0 .. entityCount - 1`) and one
 * directed edge per tally (stock → foil), each edge carrying both directed capacities. Deterministic — nodes
 * are added in entity-id order and edges in `network.tallies` order — so the same network always yields the
 * same graph (positions are added later by the seeded layout).
 */
export function buildGraph(network: Network): TallyGraph {
	const graph: TallyGraph = new MultiDirectedGraph<TallyNodeAttributes, TallyEdgeAttributes>()

	for (let id = 0; id < network.entityCount; id++) {
		graph.addNode(entityName(id), { entityId: id, label: entityName(id), x: 0, y: 0 })
	}

	network.tallies.forEach((tally, index) => {
		graph.addDirectedEdgeWithKey(edgeKeyForTally(index), entityName(tally.stock), entityName(tally.foil), {
			tallyIndex: index,
			stock: tally.stock,
			foil: tally.foil,
			capStockToFoil: capStockToFoil(tally),
			capFoilToStock: capFoilToStock(tally),
		})
	})

	return graph
}
