/**
 * Tests for the pure overlay builder. No sigma, no DOM — a hand-built {@link ActiveSet} plus the real palette
 * in, a plain {@link ReplayOverlay} out. Locks the encodings the renderer relies on: round colours, the pruned
 * fade + reason note, distinct sleeping/late marks, isolate dim, and colour-by-session.
 */

import { buildOverlay, mergeOverlays, VOID_FLASH_MS } from './paint.js'
import { lightPalette } from '../app/theme.js'
import type { ActiveSet, ConsensusState } from '../core/timeline.js'

/** An empty active set; tests fill only the fields they exercise. */
function emptyActive(): ActiveSet {
	return { nodes: [], edges: [], pruned: [], foundPlans: [] }
}

describe('buildOverlay — spreading', () => {
	test('lit nodes and edges take the round-scale colour by round', () => {
		const active = emptyActive()
		active.nodes = [
			{ node: 0, round: 0, depth: 0 },
			{ node: 1, round: 2, depth: 1 },
		]
		active.edges = [{ tally: 5, round: 1, depth: 1, lastEventKind: 'query-sent' }]
		const overlay = buildOverlay({ active, sleeping: new Set(), late: new Set(), palette: lightPalette })

		expect(overlay.nodes.get('0')?.color).toBe(lightPalette.roundScale[0])
		expect(overlay.nodes.get('1')?.color).toBe(lightPalette.roundScale[2])
		expect(overlay.edges.get('T5')?.color).toBe(lightPalette.roundScale[1])
		// Lit edges rise above un-lit ones; the overlay does not resize them (capacity thickness is kept).
		expect(overlay.edges.get('T5')?.zIndex).toBe(1)
		expect(overlay.edges.get('T5')?.size).toBeUndefined()
		expect(overlay.dim).toBeUndefined()
	})

	test('a round past the last step clamps to the last colour', () => {
		const active = emptyActive()
		const beyond = lightPalette.roundScale.length + 3
		active.nodes = [{ node: 0, round: beyond, depth: 0 }]
		const overlay = buildOverlay({ active, sleeping: new Set(), late: new Set(), palette: lightPalette })
		expect(overlay.nodes.get('0')?.color).toBe(lightPalette.roundScale[lightPalette.roundScale.length - 1])
	})

	test('pruned edges fade and carry the reason as a note, overriding a lit colour', () => {
		const active = emptyActive()
		// Same tally is both lit and pruned — pruning must win.
		active.edges = [{ tally: 2, round: 1, depth: 1, lastEventKind: 'candidate-pruned' }]
		active.pruned = [{ tally: 2, reason: 'cycle' }]
		const overlay = buildOverlay({ active, sleeping: new Set(), late: new Set(), palette: lightPalette })

		expect(overlay.edges.get('T2')?.color).toBe(lightPalette.pruned)
		expect(overlay.edges.get('T2')?.note).toBe('pruned: cycle')
		expect(overlay.edges.get('T2')?.zIndex).toBe(0)
	})

	test('sleeping and late nodes take distinct marks for the whole set, sleeping winning over late', () => {
		const active = emptyActive()
		active.nodes = [{ node: 7, round: 0, depth: 0 }] // reached, but also asleep below
		const overlay = buildOverlay({
			active,
			sleeping: new Set([7]),
			late: new Set([7, 8]),
			palette: lightPalette,
		})
		// 7 is in both sets and lit — sleeping wins over both the round colour and late.
		expect(overlay.nodes.get('7')?.color).toBe(lightPalette.sleeping)
		// 8 is late only and never reached — still marked.
		expect(overlay.nodes.get('8')?.color).toBe(lightPalette.late)
	})

	test('colour-by-session overrides the round colour with the session hue', () => {
		const active = emptyActive()
		active.nodes = [{ node: 1, round: 3, depth: 1 }]
		active.edges = [{ tally: 1, round: 3, depth: 1, lastEventKind: 'query-sent' }]
		const hue = '#123456'
		const overlay = buildOverlay({ active, sleeping: new Set(), late: new Set(), palette: lightPalette, sessionColor: hue })
		expect(overlay.nodes.get('1')?.color).toBe(hue)
		expect(overlay.edges.get('T1')?.color).toBe(hue)
	})
})

describe('buildOverlay — isolate', () => {
	test('keys only the route nodes/edges in found and sets dim', () => {
		const active = emptyActive()
		// Spreading data is present but must be ignored in isolate mode.
		active.nodes = [{ node: 9, round: 0, depth: 0 }]
		active.edges = [{ tally: 9, round: 0, depth: 0, lastEventKind: 'query-sent' }]
		const overlay = buildOverlay({
			active,
			sleeping: new Set([9]),
			late: new Set(),
			palette: lightPalette,
			isolate: { nodes: [0, 1, 2], tallies: [3, 4] },
		})

		expect([...overlay.nodes.keys()].sort()).toEqual(['0', '1', '2'])
		expect([...overlay.edges.keys()].sort()).toEqual(['T3', 'T4'])
		expect(overlay.nodes.get('0')?.color).toBe(lightPalette.found)
		expect(overlay.edges.get('T3')?.color).toBe(lightPalette.found)
		expect(overlay.dim).toEqual({ node: lightPalette.dimmed, edge: lightPalette.dimmed })
		// The asleep/lit node 9 is not keyed — it dims with everything else.
		expect(overlay.nodes.has('9')).toBe(false)
	})
})

describe('buildOverlay — consensus layer', () => {
	const SETTLED = 40

	test('a committed lift solidifies every route edge and settles its nodes', () => {
		const consensus: ConsensusState = {
			transactionCode: 'TX1',
			edges: [{ tally: 0, phase: 'committed' }, { tally: 1, phase: 'committed' }],
			nodes: [{ node: 0, phase: 'settled' }, { node: 1, phase: 'settled' }, { node: 2, phase: 'settled', vote: 'C' }],
			decision: 'commit',
			settledTime: SETTLED,
			unresolved: [],
		}
		const overlay = buildOverlay({ active: emptyActive(), sleeping: new Set(), late: new Set(), palette: lightPalette, consensus, currentTime: 1000 })
		// Every tallyPath edge reads solid committed (colour + size boost, risen highest). Commit never flashes,
		// so a `currentTime` far past the settle still shows solid.
		for (const key of ['T0', 'T1']) {
			expect(overlay.edges.get(key)?.color).toBe(lightPalette.committed)
			expect(overlay.edges.get(key)?.size).toBe(6)
			expect(overlay.edges.get(key)?.zIndex).toBe(3)
		}
		expect(overlay.nodes.get('0')?.color).toBe(lightPalette.committed)
		expect(overlay.nodes.get('2')?.color).toBe(lightPalette.committed)
	})

	test('a voided lift flashes its released hop inside the window, then clears to resting after', () => {
		const consensus: ConsensusState = {
			transactionCode: 'TX1',
			edges: [{ tally: 0, phase: 'released' }],
			nodes: [{ node: 0, phase: 'settled' }, { node: 2, phase: 'settled', vote: 'NC' }],
			decision: 'void',
			settledTime: SETTLED,
			unresolved: [],
		}
		// Inside the flash window: the released hop (and its nodes) flash the void colour.
		const flashing = buildOverlay({ active: emptyActive(), sleeping: new Set(), late: new Set(), palette: lightPalette, consensus, currentTime: SETTLED + VOID_FLASH_MS })
		expect(flashing.edges.get('T0')?.color).toBe(lightPalette.voidFlash)
		expect(flashing.nodes.get('0')?.color).toBe(lightPalette.voidFlash)

		// Past the window: the hop is not keyed — it falls back to its resting/discovery style (absent here).
		const cleared = buildOverlay({ active: emptyActive(), sleeping: new Set(), late: new Set(), palette: lightPalette, consensus, currentTime: SETTLED + VOID_FLASH_MS + 1 })
		expect(cleared.edges.has('T0')).toBe(false)
		expect(cleared.nodes.has('0')).toBe(false)
	})

	test('a stalled (undecided) lift keeps its promised hops promised', () => {
		const consensus: ConsensusState = {
			transactionCode: 'TX1',
			edges: [{ tally: 0, phase: 'promised' }, { tally: 1, phase: 'promised' }],
			nodes: [{ node: 0, phase: 'promised' }, { node: 1, phase: 'promised' }],
			decision: undefined,
			settledTime: undefined,
			unresolved: [],
		}
		const overlay = buildOverlay({ active: emptyActive(), sleeping: new Set(), late: new Set(), palette: lightPalette, consensus, currentTime: 1000 })
		expect(overlay.edges.get('T0')?.color).toBe(lightPalette.promised)
		expect(overlay.edges.get('T0')?.zIndex).toBe(2)
		expect(overlay.edges.get('T0')?.size).toBeUndefined() // promised keeps the resting capacity thickness
		expect(overlay.nodes.get('1')?.color).toBe(lightPalette.promised)
	})

	test('an in-flight vote previews differently for commit-pending (C) vs no-commit (NC)', () => {
		const consensus: ConsensusState = {
			transactionCode: 'TX1',
			edges: [],
			nodes: [{ node: 1, phase: 'voted', vote: 'C' }, { node: 2, phase: 'voted', vote: 'NC' }],
			decision: undefined,
			settledTime: undefined,
			unresolved: [],
		}
		const overlay = buildOverlay({ active: emptyActive(), sleeping: new Set(), late: new Set(), palette: lightPalette, consensus, currentTime: 20 })
		expect(overlay.nodes.get('1')?.color).toBe(lightPalette.committed) // commit-pending
		expect(overlay.nodes.get('2')?.color).toBe(lightPalette.voidFlash) // no-commit
	})

	test('the consensus layer composes over the discovery spread, winning the hops it touches', () => {
		const active = emptyActive()
		// A discovery-lit edge + node that the committed lift will override.
		active.nodes = [{ node: 0, round: 1, depth: 1 }]
		active.edges = [{ tally: 0, round: 1, depth: 1, lastEventKind: 'query-sent' }]
		const consensus: ConsensusState = {
			transactionCode: 'TX1',
			edges: [{ tally: 0, phase: 'committed' }],
			nodes: [{ node: 0, phase: 'settled' }],
			decision: 'commit',
			settledTime: SETTLED,
			unresolved: [],
		}
		const overlay = buildOverlay({ active, sleeping: new Set(), late: new Set(), palette: lightPalette, consensus, currentTime: 1000 })
		// Consensus is later in event time, so it wins over the discovery round colour on the shared edge/node.
		expect(overlay.edges.get('T0')?.color).toBe(lightPalette.committed)
		expect(overlay.nodes.get('0')?.color).toBe(lightPalette.committed)
	})

	test('isolate mode suppresses the consensus layer (the route selection stays the found green)', () => {
		const consensus: ConsensusState = {
			transactionCode: 'TX1',
			edges: [{ tally: 3, phase: 'committed' }],
			nodes: [{ node: 0, phase: 'settled' }],
			decision: 'commit',
			settledTime: SETTLED,
			unresolved: [],
		}
		const overlay = buildOverlay({
			active: emptyActive(),
			sleeping: new Set(),
			late: new Set(),
			palette: lightPalette,
			isolate: { nodes: [0, 1], tallies: [3] },
			consensus,
			currentTime: 1000,
		})
		// Isolate wins: the edge is the found-route green, not the committed colour, and dim is set.
		expect(overlay.edges.get('T3')?.color).toBe(lightPalette.found)
		expect(overlay.dim).toEqual({ node: lightPalette.dimmed, edge: lightPalette.dimmed })
	})
})

describe('mergeOverlays', () => {
	test('merges node/edge maps with the later overlay winning a conflict', () => {
		const a = buildOverlay({
			active: { ...emptyActive(), nodes: [{ node: 0, round: 0, depth: 0 }] },
			sleeping: new Set(),
			late: new Set(),
			palette: lightPalette,
			sessionColor: '#aaaaaa',
		})
		const b = buildOverlay({
			active: { ...emptyActive(), nodes: [{ node: 0, round: 0, depth: 0 }, { node: 1, round: 0, depth: 0 }] },
			sleeping: new Set(),
			late: new Set(),
			palette: lightPalette,
			sessionColor: '#bbbbbb',
		})
		const merged = mergeOverlays([a, b])
		expect(merged.nodes.get('0')?.color).toBe('#bbbbbb') // b (later) wins the shared key
		expect(merged.nodes.get('1')?.color).toBe('#bbbbbb')
		expect(merged.dim).toBeUndefined()
	})
})
