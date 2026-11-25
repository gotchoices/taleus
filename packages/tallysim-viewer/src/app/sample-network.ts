/**
 * A ready-made in-page {@link Network} for the "Load sample" button — so a developer can exercise the graph
 * view (pan / zoom / hover / search, and the off-main-thread layout) without first producing a trace file
 * from the `tallysim` CLI.
 *
 * It is materialised by a real `tallysim` generator (not hand-built), so it is a faithful network: a
 * scale-free topology (a few high-degree hubs, many leaves — the realistic stress case for the layout and
 * the renderer) with a lognormal capacity distribution, which gives a spread of finite total-swings so the
 * edge thickness/colour ramp is visibly exercised. The generator is seeded, and that seed is surfaced as
 * `meta.seed` so the shell can feed it to `runLayout` for a deterministic, replayable layout.
 */

import { scaleFree, type Network } from 'tallysim'

/** The seed the sample is generated from (and the one the layout should be seeded with for a stable shape). */
const SAMPLE_SEED = 20260411

/**
 * Build the demo network: ~3000 entities, scale-free (`edgesPerNode = 2` ⇒ ~6000 tallies), with lognormal
 * capacities so finite edges span a range the thickness/colour ramp can show. Deterministic in `SAMPLE_SEED`.
 */
export function sampleNetwork(): Network {
	return scaleFree({
		entityCount: 3000,
		edgesPerNode: 2,
		seed: SAMPLE_SEED,
		capacity: { kind: 'lognormal', mu: 3, sigma: 0.8 },
	})
}
