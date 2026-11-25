/**
 * The shape-agnostic sweep machinery shared by the oracle sweep runner (`runner.ts`) and the discovery
 * sweep runner (`sim/sim-runner.ts`): take the cartesian product of a {@link VarySpec} list, resolve one
 * cell's coordinates, and set a numeric leaf at a dotted path on a cloned scenario. None of this depends on
 * *which* scenario shape is being swept (`ScenarioSpec` vs `SimScenario`), so both runners reuse one copy —
 * the two stay in lock-step and there is a single place the cartesian/path logic lives.
 *
 * Each function is pure and allocation-only (no I/O, no randomness), so a sweep stays deterministic: the
 * same `vary` list always yields the same cells in the same order.
 */

import type { VarySpec } from './scenario.js'

/** One resolved varied leaf: the dotted path and the numeric value to set there. */
export interface VaryAssignment {
	path: string
	value: number
}

/**
 * The cartesian product of every `vary` dimension's values: one assignment list per sweep cell, in a fixed
 * order (dimensions left-to-right, values in their given order), so a sweep replays cell-for-cell.
 */
export function cartesian(vary: readonly VarySpec[]): VaryAssignment[][] {
	let cells: VaryAssignment[][] = [[]]
	for (const dim of vary) {
		const next: VaryAssignment[][] = []
		for (const cell of cells) {
			for (const value of dim.values) {
				next.push([...cell, { path: dim.path, value }])
			}
		}
		cells = next
	}
	return cells
}

/** The resolved values of one cell, keyed by path — the record's sweep coordinates. */
export function coordsOf(assignment: readonly VaryAssignment[]): Record<string, number> {
	const coords: Record<string, number> = {}
	for (const { path, value } of assignment) {
		coords[path] = value
	}
	return coords
}

/** Set a numeric leaf at a dotted `path` on `target`. Throws if an intermediate is not an object. */
export function setByPath(target: object, path: string, value: number): void {
	const keys = path.split('.')
	let cursor: Record<string, unknown> = target as Record<string, unknown>
	for (let i = 0; i < keys.length - 1; i++) {
		const next = cursor[keys[i]]
		if (typeof next !== 'object' || next === null) {
			throw new Error(`sweep vary: path "${path}" has no object at "${keys[i]}"`)
		}
		cursor = next as Record<string, unknown>
	}
	cursor[keys[keys.length - 1]] = value
}

/** Reject a vary dimension whose `values` array is missing or empty, with a clear message. */
export function requireNonEmptyValues(vary: readonly VarySpec[]): void {
	for (const dim of vary) {
		if (!Array.isArray(dim.values) || dim.values.length === 0) {
			throw new Error(`sweep: vary dimension "${dim.path}" must have a non-empty values array`)
		}
	}
}
