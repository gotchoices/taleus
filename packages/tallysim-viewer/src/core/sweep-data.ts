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
	/**
	 * When set, a row whose value in this column is `0` (or absent) contributes **no** point. This is the
	 * distribution-summary "no data" guard: `summarizeDistribution` reports `count: 0` with every scalar
	 * **zeroed** (not non-finite), so plotting e.g. `pathLength.mean` where `pathLength.count` is `0` would
	 * draw a spurious `y = 0`; set this to the family's `.count` column so that cell becomes a gap instead.
	 * Leave unset when the chosen metric *is* the count itself (there `0` is a real value).
	 */
	gapWhenZeroColumn?: string
}

/** What a column means in a sweep: a string dimension, a swept parameter, the repeat `seed`, or a metric. */
export type ColumnRole = 'dimension' | 'param' | 'seed' | 'metric'

/** One column of a loaded sweep, with enough metadata to drive the axis / metric / series pickers. */
export interface SweepColumn {
	/** The flat column name (`generator`, `network.params.edgesPerNode`, `pathLength.mean`, …). */
	name: string
	/** What the column means — where it came from in the record. */
	role: ColumnRole
	/** `'string'` for the `generator` / `capacity` dimensions; `'number'` for params, `seed` and metrics. */
	kind: 'string' | 'number'
	/** The distinct present values seen across rows (strings for a dimension, numbers otherwise). */
	values: (number | string)[]
	/** True when more than one distinct value was seen — i.e. a column the sweep actually varied. */
	varied: boolean
}

/** A loaded sweep: the flat rows plus the described columns (the two formats read to the same shape). */
export interface SweepTable {
	rows: SweepRow[]
	columns: SweepColumn[]
}

/** A `DistributionSummary` family expanded across `count/mean/min/max/p50/p90/p99` columns in the data. */
export interface DistributionFamily {
	/** The shared prefix, e.g. `pathLength` or `timeToFirstPlanMs`. */
	family: string
	/** The `${family}.count` column — `0` marks "no data" for the whole family (see {@link SeriesSpec}). */
	countColumn: string
	/** The present sub-field columns under the family, e.g. `['count','mean',…,'p99']`. */
	subFields: string[]
}

/** A default axis / metric / series choice derived from a loaded file's columns. */
export interface SweepSelection {
	xColumn: string
	metricColumn: string
	seriesBy: string[]
}

/** The seven flattened sub-fields of a `DistributionSummary`, in serialiser order. */
const DISTRIBUTION_SUBFIELDS: readonly string[] = ['count', 'mean', 'min', 'max', 'p50', 'p90', 'p99']

/** True for a value usable as a finite numeric coordinate. */
function isFiniteNumber(value: number | string | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Flatten one parsed JSON-lines record (nested `{generator, capacity, params, seed, metrics}`) to a
 * {@link SweepRow}, descending exactly one level into `params` and `metrics` — the same flattening
 * `tallysim`'s `serialize-records.ts` applies when it writes the CSV, so the two formats share columns.
 * A `null` (the non-finite sentinel) or any non-finite number is left **absent** from the row, but the
 * column's {@link ColumnRole} is still recorded in `roles` (by key presence), so a column that is non-finite
 * on one line and finite on another is still classified.
 */
function recordToRow(record: unknown, roles: Map<string, ColumnRole>): SweepRow {
	const row: SweepRow = new Map()
	if (record === null || typeof record !== 'object') {
		return row
	}
	const obj = record as Record<string, unknown>
	setString(row, 'generator', obj.generator)
	setString(row, 'capacity', obj.capacity)
	setNumber(row, 'seed', obj.seed)
	if (typeof obj.generator === 'string') {
		roles.set('generator', 'dimension')
	}
	if (typeof obj.capacity === 'string') {
		roles.set('capacity', 'dimension')
	}
	if (typeof obj.seed === 'number') {
		roles.set('seed', 'seed')
	}
	flattenInto(row, obj.params, 'param', roles)
	flattenInto(row, obj.metrics, 'metric', roles)
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
 * Flatten a container one level into `row`, tagging each column it produces with `role`: a number member
 * becomes column `key`; an object member (a `DistributionSummary`, or a numeric tally like `pruneReasons`)
 * expands its numeric sub-fields as `key.sub`. Mirrors `serialize-records.ts`'s one-level `flattenMetrics`;
 * a two-level-nested numeric object would be dropped here too (none exists today). The role is recorded for
 * every key seen (even when its value is non-finite and so left out of `row`), so classification is complete.
 */
function flattenInto(row: SweepRow, container: unknown, role: ColumnRole, roles: Map<string, ColumnRole>): void {
	if (container === null || typeof container !== 'object') {
		return
	}
	for (const [key, value] of Object.entries(container as Record<string, unknown>)) {
		if (typeof value === 'number') {
			roles.set(key, role)
			setNumber(row, key, value)
		} else if (value !== null && typeof value === 'object') {
			for (const [sub, subValue] of Object.entries(value as Record<string, unknown>)) {
				roles.set(`${key}.${sub}`, role)
				setNumber(row, `${key}.${sub}`, subValue)
			}
		}
	}
}

/**
 * Read JSON-lines sweep text into a {@link SweepTable} (rows + described columns). Blank lines are skipped;
 * each non-blank line is parsed with `tallysim`'s {@link parseSimJsonLine} and flattened to the shared column
 * vocabulary, with each column classified (`params` → param, `metrics` → metric, …).
 */
export function readSweepJsonl(text: string): SweepTable {
	const rows: SweepRow[] = []
	const roles = new Map<string, ColumnRole>()
	for (const line of text.split('\n')) {
		if (line.trim() === '') {
			continue
		}
		rows.push(recordToRow(parseSimJsonLine(line), roles))
	}
	return { rows, columns: describeColumns(rows, roles) }
}

/**
 * Read an RFC 4180 CSV summary into a {@link SweepTable}. The first record is the header. `generator` and
 * `capacity` cells stay strings; every other non-empty cell is read as a number (an empty cell is absent, so a
 * non-finite metric — written empty by the serialiser — is absent, never `0`). A non-empty, non-numeric cell
 * in a numeric column is also left absent rather than coerced. Column roles follow the serialiser's header
 * order — `generator, capacity, <params…>, seed, <metrics…>` — so the columns before `seed` are params and
 * those after it are metrics.
 */
export function readSweepCsv(text: string): SweepTable {
	const records = parseCsv(text)
	if (records.length === 0) {
		return { rows: [], columns: [] }
	}
	const header = records[0]
	const roles = csvColumnRoles(header)
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
	return { rows, columns: describeColumns(rows, roles) }
}

/** Parse JSON-lines sweep text into {@link SweepRow}s (the rows of {@link readSweepJsonl}). */
export function parseSweepJsonl(text: string): SweepRow[] {
	return readSweepJsonl(text).rows
}

/** Parse an RFC 4180 CSV summary into {@link SweepRow}s (the rows of {@link readSweepCsv}). */
export function parseSweepCsv(text: string): SweepRow[] {
	return readSweepCsv(text).rows
}

/** Classify CSV header columns by position: params sit before the `seed` column, metrics after it. */
function csvColumnRoles(header: readonly string[]): Map<string, ColumnRole> {
	const roles = new Map<string, ColumnRole>()
	const seedIndex = header.indexOf('seed')
	header.forEach((name, i) => {
		if (name === 'generator' || name === 'capacity') {
			roles.set(name, 'dimension')
		} else if (name === 'seed') {
			roles.set(name, 'seed')
		} else if (seedIndex >= 0 && i < seedIndex) {
			roles.set(name, 'param')
		} else {
			roles.set(name, 'metric')
		}
	})
	return roles
}

/** Rank the four roles for a stable, menu-friendly column order (dimensions, params, seed, then metrics). */
const ROLE_RANK: Record<ColumnRole, number> = { dimension: 0, param: 1, seed: 2, metric: 3 }

/**
 * Build {@link SweepColumn}s from the rows and the role map: each column's distinct present values and whether
 * it varied. Columns are ordered by role then name so the pickers list dimensions, then swept params, then
 * metrics. The `kind` is `'string'` only for the dimension columns (`generator` / `capacity`).
 */
function describeColumns(rows: readonly SweepRow[], roles: Map<string, ColumnRole>): SweepColumn[] {
	const valuesByColumn = new Map<string, Set<number | string>>()
	for (const row of rows) {
		for (const [column, value] of row) {
			let seen = valuesByColumn.get(column)
			if (seen === undefined) {
				seen = new Set()
				valuesByColumn.set(column, seen)
			}
			seen.add(value)
		}
	}
	const names = new Set<string>([...roles.keys(), ...valuesByColumn.keys()])
	const columns: SweepColumn[] = []
	for (const name of names) {
		const role = roles.get(name) ?? (name === 'generator' || name === 'capacity' ? 'dimension' : 'metric')
		const seen = valuesByColumn.get(name) ?? new Set<number | string>()
		columns.push({
			name,
			role,
			kind: role === 'dimension' ? 'string' : 'number',
			values: [...seen],
			varied: seen.size > 1,
		})
	}
	return columns.sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * Group metric columns that follow the `DistributionSummary` shape (`${family}.count` plus one or more of
 * `mean/min/max/p50/p90/p99`) into {@link DistributionFamily}s. A numeric tally like `pruneReasons.cycle` is
 * **not** a family — its sub-fields are not the distribution sub-fields — so it stays a plain metric column.
 */
export function distributionFamilies(columns: readonly SweepColumn[]): DistributionFamily[] {
	const subsByFamily = new Map<string, Set<string>>()
	for (const column of columns) {
		if (column.role !== 'metric') {
			continue
		}
		const dot = column.name.lastIndexOf('.')
		if (dot < 0) {
			continue
		}
		const family = column.name.slice(0, dot)
		const sub = column.name.slice(dot + 1)
		if (!DISTRIBUTION_SUBFIELDS.includes(sub)) {
			continue
		}
		let subs = subsByFamily.get(family)
		if (subs === undefined) {
			subs = new Set()
			subsByFamily.set(family, subs)
		}
		subs.add(sub)
	}
	const families: DistributionFamily[] = []
	for (const [family, subs] of subsByFamily) {
		if (!subs.has('count')) {
			continue
		}
		families.push({
			family,
			countColumn: `${family}.count`,
			subFields: DISTRIBUTION_SUBFIELDS.filter((sub) => subs.has(sub)),
		})
	}
	return families.sort((a, b) => (a.family < b.family ? -1 : a.family > b.family ? 1 : 0))
}

/** Metric names preferred as the default y-axis, most-wanted first (the headline found-vs-oracle fractions). */
const PREFERRED_METRICS: readonly string[] = ['pFoundGivenExists', 'pRouteExists', 'routeExistsCount', 'foundCount']

/** The x-axis columns that read as "how densely connected", preferred as the default x when a sweep varies one. */
const CONNECTIVITY_HINT = /degree|edgespernode|connect/i

/**
 * A sensible default axis / metric / series choice for a freshly-loaded file. The x-axis is the first swept
 * parameter (preferring a connectivity-named one); the metric is the first present headline fraction; the
 * series split is `generator` + `capacity` plus every *other* swept parameter — so the common chart
 * ("metric vs a swept parameter, one line per generator/capacity/other-dimension") comes up without fiddling.
 * Any field can be empty when the file has nothing to put there (e.g. a single-cell sweep has no varied param).
 */
export function defaultSelection(table: SweepTable): SweepSelection {
	const numericColumns = table.columns.filter((column) => column.kind === 'number' && column.role !== 'seed')
	const variedParams = table.columns.filter((column) => column.role === 'param' && column.varied)
	const xColumn = pickXColumn(variedParams, numericColumns)
	const metricColumn = pickMetricColumn(table.columns, xColumn)
	const dimensions = table.columns.filter((column) => column.role === 'dimension').map((column) => column.name)
	const otherVariedParams = variedParams.map((column) => column.name).filter((name) => name !== xColumn)
	return { xColumn, metricColumn, seriesBy: [...dimensions, ...otherVariedParams] }
}

/** Choose the default x column: a connectivity-named swept param, else any swept param, else any numeric column. */
function pickXColumn(variedParams: readonly SweepColumn[], numericColumns: readonly SweepColumn[]): string {
	const connectivity = variedParams.find((column) => CONNECTIVITY_HINT.test(column.name))
	if (connectivity !== undefined) {
		return connectivity.name
	}
	if (variedParams.length > 0) {
		return variedParams[0].name
	}
	const variedNumeric = numericColumns.find((column) => column.varied)
	return variedNumeric?.name ?? numericColumns[0]?.name ?? ''
}

/** Choose the default metric column: a preferred headline fraction if present, else the first metric ≠ x. */
function pickMetricColumn(columns: readonly SweepColumn[], xColumn: string): string {
	const metrics = columns.filter((column) => column.role === 'metric' && column.name !== xColumn)
	for (const preferred of PREFERRED_METRICS) {
		if (metrics.some((column) => column.name === preferred)) {
			return preferred
		}
	}
	const scalar = metrics.find((column) => !column.name.includes('.'))
	return scalar?.name ?? metrics[0]?.name ?? ''
}

/**
 * Collapse repeated-seed points to **one mean point per (series, x) cell**. The sweep repeats each cell over
 * several seeds, so a series can hold several points at the same x; this averages them, yielding the clean
 * line the chart draws. (See `docs/design.md` § Sweeps view on why the per-seed raw points are not scattered.)
 */
export function meanPerCell(series: readonly TidySeries[]): TidySeries[] {
	return series.map((entry) => {
		const byX = new Map<number, { sum: number; count: number }>()
		for (const point of entry.points) {
			let cell = byX.get(point.x)
			if (cell === undefined) {
				cell = { sum: 0, count: 0 }
				byX.set(point.x, cell)
			}
			cell.sum += point.y
			cell.count++
		}
		const points = [...byX.entries()]
			.map(([x, cell]) => ({ x, y: cell.sum / cell.count }))
			.sort((a, b) => a.x - b.x)
		return { seriesKey: entry.seriesKey, points }
	})
}

/** A set of series aligned onto one shared, sorted x-axis — the shape a chart feeds to uPlot's aligned data. */
export interface AlignedSeries {
	/** The union of every series' x values, ascending. */
	x: number[]
	/** One entry per series: its key and a y value per shared-x index (`null` where that series has no point). */
	columns: { seriesKey: string; y: (number | null)[] }[]
}

/**
 * Align series onto one shared x-axis: the union of all x values (ascending), and for each series a y array
 * the same length, holding its y where it has that x and `null` (a line gap) where it does not. A `null` is a
 * genuine gap, never a `0` — the chart draws a break in the line there.
 */
export function alignSeries(series: readonly TidySeries[]): AlignedSeries {
	const xs = new Set<number>()
	for (const entry of series) {
		for (const point of entry.points) {
			xs.add(point.x)
		}
	}
	const x = [...xs].sort((a, b) => a - b)
	const indexOfX = new Map(x.map((value, index) => [value, index]))
	const columns = series.map((entry) => {
		const y: (number | null)[] = x.map(() => null)
		for (const point of entry.points) {
			const index = indexOfX.get(point.x)
			if (index !== undefined) {
				y[index] = point.y
			}
		}
		return { seriesKey: entry.seriesKey, y }
	})
	return { x, columns }
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
		if (spec.gapWhenZeroColumn !== undefined) {
			const count = row.get(spec.gapWhenZeroColumn)
			if (!isFiniteNumber(count) || count === 0) {
				continue
			}
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
