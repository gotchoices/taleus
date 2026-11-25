/**
 * Parse `tallysim`'s sweep output into tidy chart series for the sweep-charts ticket. The CLI
 * (`cli/simulate.ts` / `cli/sweep.ts`) writes two formats and this reads both back to the **same** series:
 *
 *   - **JSON-lines** — one `SimRunRecord` per line, parsed with `tallysim`'s own {@link parseSimJsonLine} (we
 *     do not re-implement it, so we inherit the `Infinity ↔ null` convention: a non-finite metric is written
 *     as JSON `null`).
 *   - **CSV summary** — one row per run; the header names `generator`, `capacity`, each varied param path,
 *     `seed`, then the flattened metric columns (`pFoundGivenExists`, `timeToFirstPlanMs.mean`,
 *     `pruneReasons.cycle`, …). A non-finite metric is written as an **empty cell**, matching the serialiser.
 *
 * Both are read to a common flat-row shape ({@link SweepRow}: `column → number | string`, a non-finite or
 * empty value **absent**), so {@link rowsToSeries} produces byte-identical series from either format. A `null`
 * / empty value is therefore read back as **absent**, never `0` — so a point it would have produced is simply
 * omitted, not plotted at zero.
 *
 * ── Why a flat row, not the nested record ──────────────────────────────────────────────────────────
 * The CSV is inherently flat (dotted metric columns); the JSON-lines record is nested. Flattening the nested
 * record one level — exactly as `tallysim`'s `serialize-records.ts` flattens it *into* the CSV — gives both
 * inputs the same column vocabulary, so a caller selects an x-axis, a metric and the series-splitting columns
 * by the same column names regardless of which format it loaded.
 */

import { parseSimJsonLine } from 'tallysim'

/**
 * One run as flat columns: `generator`/`capacity` are strings, every param path / `seed` / metric column is a
 * number. A column whose value was non-finite (JSON `null`) or an empty CSV cell is **absent** from the map.
 */
export type SweepRow = Map<string, number | string>

/** A tidy chart series: a key identifying the series and its points, each an `{x, y}` of finite numbers. */
export interface TidySeries {
	seriesKey: string
	points: { x: number; y: number }[]
}

/** How to turn rows into series: which column is the x-axis, which is the metric (y), and what splits series. */
export interface SeriesSpec {
	/** Column name for the x-axis (a param path, e.g. `network.params.meanDegree`). */
	xColumn: string
	/** Column name for the metric (y), e.g. `pFoundGivenExists` or `timeToFirstPlanMs.mean`. */
	metricColumn: string
	/**
	 * Columns whose values split the data into one series each (e.g. `['generator', 'capacity']`). A row's
	 * series key is these columns' values joined; omit for a single series.
	 */
	seriesBy?: readonly string[]
}

/** True for a value usable as a finite numeric coordinate. */
function isFiniteNumber(value: number | string | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Flatten one parsed JSON-lines record (nested `{generator, capacity, params, seed, metrics}`) to a
 * {@link SweepRow}, descending exactly one level into `params` and `metrics` — the same flattening
 * `tallysim`'s `serialize-records.ts` applies when it writes the CSV, so the two formats share columns.
 * A `null` (the non-finite sentinel) or any non-finite number is left **absent**.
 */
function recordToRow(record: unknown): SweepRow {
	const row: SweepRow = new Map()
	if (record === null || typeof record !== 'object') {
		return row
	}
	const obj = record as Record<string, unknown>
	setString(row, 'generator', obj.generator)
	setString(row, 'capacity', obj.capacity)
	setNumber(row, 'seed', obj.seed)
	flattenInto(row, '', obj.params)
	flattenInto(row, '', obj.metrics)
	return row
}

/** Set a string column if `value` is a string. */
function setString(row: SweepRow, column: string, value: unknown): void {
	if (typeof value === 'string') {
		row.set(column, value)
	}
}

/** Set a numeric column if `value` is a finite number (non-finite / null / missing stays absent). */
function setNumber(row: SweepRow, column: string, value: unknown): void {
	if (typeof value === 'number' && Number.isFinite(value)) {
		row.set(column, value)
	}
}

/**
 * Flatten a container one level into `row` under `prefix`: a number member becomes `prefix+key`; an object
 * member (a `DistributionSummary`, or a numeric tally like `pruneReasons`) expands its numeric sub-fields as
 * `prefix+key.sub`. Mirrors `serialize-records.ts`'s one-level `flattenMetrics`; a two-level-nested numeric
 * object would be dropped here too (none exists today).
 */
function flattenInto(row: SweepRow, prefix: string, container: unknown): void {
	if (container === null || typeof container !== 'object') {
		return
	}
	for (const [key, value] of Object.entries(container as Record<string, unknown>)) {
		if (typeof value === 'number') {
			setNumber(row, `${prefix}${key}`, value)
		} else if (value !== null && typeof value === 'object') {
			for (const [sub, subValue] of Object.entries(value as Record<string, unknown>)) {
				setNumber(row, `${prefix}${key}.${sub}`, subValue)
			}
		}
	}
}

/**
 * Parse JSON-lines sweep text into {@link SweepRow}s. Blank lines are skipped. Each non-blank line is parsed
 * with `tallysim`'s {@link parseSimJsonLine} and flattened to the shared column vocabulary.
 */
export function parseSweepJsonl(text: string): SweepRow[] {
	const rows: SweepRow[] = []
	for (const line of text.split('\n')) {
		if (line.trim() === '') {
			continue
		}
		rows.push(recordToRow(parseSimJsonLine(line)))
	}
	return rows
}

/**
 * Parse an RFC 4180 CSV summary into {@link SweepRow}s. The first record is the header. `generator` and
 * `capacity` cells stay strings; every other non-empty cell is read as a number (an empty cell is absent, so a
 * non-finite metric — written empty by the serialiser — is absent, never `0`). A non-empty, non-numeric cell
 * in a numeric column is also left absent rather than coerced.
 */
export function parseSweepCsv(text: string): SweepRow[] {
	const records = parseCsv(text)
	if (records.length === 0) {
		return []
	}
	const header = records[0]
	const stringColumns = new Set(['generator', 'capacity'])
	const rows: SweepRow[] = []
	for (let r = 1; r < records.length; r++) {
		const cells = records[r]
		const row: SweepRow = new Map()
		for (let c = 0; c < header.length; c++) {
			const column = header[c]
			const cell = cells[c] ?? ''
			if (cell === '') {
				continue
			}
			if (stringColumns.has(column)) {
				row.set(column, cell)
			} else {
				const n = Number(cell)
				if (Number.isFinite(n)) {
					row.set(column, n)
				}
			}
		}
		rows.push(row)
	}
	return rows
}

/**
 * Group {@link SweepRow}s into {@link TidySeries} by `spec`. A row contributes a point only when **both** its
 * x and metric columns are present and finite (so an absent/non-finite metric omits the point, never plots 0).
 * Each series' points are sorted by ascending x; series are sorted by key for deterministic output.
 */
export function rowsToSeries(rows: readonly SweepRow[], spec: SeriesSpec): TidySeries[] {
	const seriesBy = spec.seriesBy ?? []
	const byKey = new Map<string, { x: number; y: number }[]>()
	for (const row of rows) {
		const x = row.get(spec.xColumn)
		const y = row.get(spec.metricColumn)
		if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
			continue
		}
		const key = seriesBy.map((column) => `${column}=${String(row.get(column) ?? '')}`).join(',')
		let points = byKey.get(key)
		if (points === undefined) {
			points = []
			byKey.set(key, points)
		}
		points.push({ x, y })
	}
	return [...byKey.entries()]
		.map(([seriesKey, points]) => ({ seriesKey, points: points.sort((a, b) => a.x - b.x) }))
		.sort((a, b) => (a.seriesKey < b.seriesKey ? -1 : a.seriesKey > b.seriesKey ? 1 : 0))
}

/**
 * A small, complete RFC 4180 CSV reader: fields may be quoted with `"`, a quoted field may contain commas,
 * newlines and escaped quotes (`""`), and rows end at an unquoted CR, LF or CRLF. Returns a list of records,
 * each a list of raw string cells. A trailing newline does not produce a spurious empty record.
 */
function parseCsv(text: string): string[][] {
	const records: string[][] = []
	let record: string[] = []
	let field = ''
	let inQuotes = false
	let sawAny = false
	let i = 0

	function endField(): void {
		record.push(field)
		field = ''
	}
	function endRecord(): void {
		endField()
		records.push(record)
		record = []
		sawAny = false
	}

	while (i < text.length) {
		const ch = text[i]
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"'
					i += 2
					continue
				}
				inQuotes = false
				i++
				continue
			}
			field += ch
			i++
			continue
		}
		if (ch === '"') {
			inQuotes = true
			sawAny = true
			i++
			continue
		}
		if (ch === ',') {
			sawAny = true
			endField()
			i++
			continue
		}
		if (ch === '\r') {
			endRecord()
			if (text[i + 1] === '\n') {
				i += 2
			} else {
				i++
			}
			continue
		}
		if (ch === '\n') {
			endRecord()
			i++
			continue
		}
		field += ch
		sawAny = true
		i++
	}
	// Flush a final record that was not newline-terminated. A dangling empty field after a trailing newline
	// (sawAny === false, field === '') is not a record.
	if (sawAny || field !== '') {
		endRecord()
	}
	return records
}
