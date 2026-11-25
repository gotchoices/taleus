/**
 * The layout orchestrator: seed deterministic initial positions, run ForceAtlas2 in a worker
 * ({@link startLayoutWorker}) until the cloud settles, then signal "settled" so callers (the replay ticket)
 * can wait for a stable layout before animating.
 *
 * ── Why seed deterministically ─────────────────────────────────────────────────────────────────────
 * ForceAtlas2 is a physics relaxation: its *final* shape depends on where the nodes *start*. If the start were
 * random each load, reloading or replaying the **same** network would reshuffle the whole cloud — the replay
 * animation would never line up twice. So the initial positions are a pure function of the node set and the
 * network's `meta.seed`: {@link seedPositions} places the nodes on a deterministic spiral keyed off that seed,
 * so the same network always relaxes from the same start to (modulo worker float drift) the same layout.
 *
 * The seeding is a pure function of the graph and seed — no worker, no DOM — so it is independently checkable.
 * The settle policy (how long to iterate) scales with graph size and is intentionally simple: ForceAtlas2 has
 * no built-in convergence test, so we iterate for a bounded wall-clock budget, then stop. The budget is capped
 * so even a trivial graph does not hang (and a graph with no edges needs no relaxation at all — the seed *is*
 * the layout).
 */

import type { TallyGraph } from './model.js'
import { startLayoutWorker, type LayoutWorkerHandle } from './layout-worker.js'

/** A deterministic 32-bit PRNG (mulberry32). Pure: same seed ⇒ same stream. */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6d2b79f5) | 0
		let t = Math.imul(state ^ (state >>> 15), 1 | state)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/**
 * Seed every node's `x`/`y` deterministically from `seed`, overwriting any previous positions. Nodes are laid
 * on a jittered phyllotaxis spiral (even areal spread, no overlap at the centre) so ForceAtlas2 has a sane,
 * reproducible starting cloud. Pure and worker-free: the same graph + seed always yields the same positions.
 */
export function seedPositions(graph: TallyGraph, seed: number): void {
	const rng = mulberry32(seed)
	const golden = Math.PI * (3 - Math.sqrt(5)) // golden angle, for an even spiral
	const spread = 10 + Math.sqrt(graph.order) * 5
	let i = 0
	graph.forEachNode((node) => {
		const radius = spread * Math.sqrt((i + 0.5) / Math.max(graph.order, 1))
		const angle = i * golden
		const jitter = (rng() - 0.5) * 2
		graph.setNodeAttribute(node, 'x', Math.cos(angle) * radius + jitter)
		graph.setNodeAttribute(node, 'y', Math.sin(angle) * radius + jitter)
		i++
	})
}

/** A running layout: subscribe to {@link onSettled}, or stop it on teardown. */
export interface LayoutController {
	/** Has the layout stopped iterating (settled)? */
	isSettled(): boolean
	/** Register a callback fired once, when the layout settles. Fires immediately if already settled. */
	onSettled(callback: () => void): void
	/** Stop the worker now (also marks settled and fires subscribers). Idempotent; call on teardown. */
	stop(): void
}

/** How long to let ForceAtlas2 iterate before declaring the cloud settled, scaled (and capped) by graph size. */
function settleBudgetMs(order: number): number {
	return Math.min(8000, 800 + order * 2)
}

/**
 * Seed positions, then run ForceAtlas2 in a worker until a size-scaled time budget elapses, then stop and fire
 * "settled". A graph with no edges needs no relaxation: it is seeded and immediately settled (the worker never
 * starts), so a trivial or edgeless graph cannot hang.
 */
export function runLayout(
	graph: TallyGraph,
	options: { seed: number; settleMs?: number } = { seed: 0 },
): LayoutController {
	seedPositions(graph, options.seed)

	let settled = false
	const subscribers: (() => void)[] = []
	let worker: LayoutWorkerHandle | undefined
	let timer: ReturnType<typeof setTimeout> | undefined

	function settle(): void {
		if (settled) {
			return
		}
		settled = true
		if (timer !== undefined) {
			clearTimeout(timer)
			timer = undefined
		}
		worker?.stop()
		for (const callback of subscribers.splice(0)) {
			callback()
		}
	}

	if (graph.size === 0) {
		// No edges ⇒ no forces; the seeded spiral is the final layout. Settle on the next tick so callers can
		// still subscribe synchronously after this returns.
		timer = setTimeout(settle, 0)
	} else {
		worker = startLayoutWorker(graph)
		timer = setTimeout(settle, options.settleMs ?? settleBudgetMs(graph.order))
	}

	return {
		isSettled: () => settled,
		onSettled(callback: () => void): void {
			if (settled) {
				callback()
				return
			}
			subscribers.push(callback)
		},
		stop: settle,
	}
}
