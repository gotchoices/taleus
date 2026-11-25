/**
 * Tests for the pure overlay builder. No sigma, no DOM — a hand-built {@link ActiveSet} plus the real palette
 * in, a plain {@link ReplayOverlay} out. Locks the encodings the renderer relies on: round colours, the pruned
 * fade + reason note, distinct sleeping/late marks, isolate dim, and colour-by-session.
 */

import { buildOverlay, mergeOverlays } from './paint.js'
import { lightPalette } from '../app/theme.js'
import type { ActiveSet } from '../core/timeline.js'

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
