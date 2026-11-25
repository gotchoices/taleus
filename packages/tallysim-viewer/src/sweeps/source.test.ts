import { detectSweepFormat, loadSweepText, SAMPLE_SWEEP, SAMPLE_SWEEP_NAME } from './source.js'

describe('detectSweepFormat', () => {
	const jsonLine = '{"generator":"uniform","seed":1,"metrics":{"pRouteExists":0.5}}'
	const csvHeader = 'generator,capacity,seed,pRouteExists'

	it('decides by extension first, ignoring the text', () => {
		// A `.csv` name wins even when the text looks like JSON-lines, and vice versa.
		expect(detectSweepFormat('x.csv', jsonLine)).toBe('csv')
		expect(detectSweepFormat('x.jsonl', csvHeader)).toBe('jsonl')
		expect(detectSweepFormat('x.ndjson', csvHeader)).toBe('jsonl')
		expect(detectSweepFormat('x.json', csvHeader)).toBe('jsonl')
	})

	it('sniffs a `{`-leading first line as JSON-lines when the extension does not settle it', () => {
		expect(detectSweepFormat('x.txt', jsonLine)).toBe('jsonl')
		expect(detectSweepFormat('x.txt', `  \n  ${jsonLine}`)).toBe('jsonl') // leading blank/space skipped
	})

	it('sniffs a `generator`-naming first line as a CSV header', () => {
		expect(detectSweepFormat('x.txt', csvHeader)).toBe('csv')
	})

	it('falls back on a comma: CSV with a comma, else JSON-lines', () => {
		expect(detectSweepFormat('x.txt', 'a,b,c')).toBe('csv')
		expect(detectSweepFormat('x.txt', 'plain line')).toBe('jsonl')
		expect(detectSweepFormat('x.txt', '')).toBe('jsonl')
	})
})

describe('loadSweepText', () => {
	it('round-trips the embedded sample into a usable table', () => {
		const table = loadSweepText(SAMPLE_SWEEP_NAME, SAMPLE_SWEEP)
		expect(table.rows).toHaveLength(12)
		// The sample varies generator, edgesPerNode and seed; those columns must classify for the pickers.
		const role = (name: string): string | undefined => table.columns.find((c) => c.name === name)?.role
		expect(role('generator')).toBe('dimension')
		expect(role('network.params.edgesPerNode')).toBe('param')
		expect(role('pRouteExists')).toBe('metric')
	})

	it('reads the same table whether the sample is named .jsonl or sniffed from text', () => {
		const byName = loadSweepText(SAMPLE_SWEEP_NAME, SAMPLE_SWEEP)
		const bySniff = loadSweepText('mystery.dat', SAMPLE_SWEEP)
		expect(bySniff).toEqual(byName)
	})

	it('lets a malformed JSON-lines line throw (surfaced by the view, not swallowed)', () => {
		expect(() => loadSweepText('broken.jsonl', '{not valid json}')).toThrow()
	})

	it('reads a valid-but-empty file to an empty table (not an error)', () => {
		expect(loadSweepText('empty.jsonl', '').rows).toEqual([])
		expect(loadSweepText('empty.csv', '').rows).toEqual([])
	})
})
