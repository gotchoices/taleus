import { Rule, RuleSet, checkRules, type RuleResponse } from './rule.js'

type Check = () => Promise<RuleResponse>

const pass = (message = 'ok'): Check => () => Promise.resolve({ passed: true, message })
const fail = (message: string): Check => () => Promise.resolve({ passed: false, message })

function resultsByName(results: { name: string; passed: boolean; message: string }[]): Map<string, { passed: boolean; message: string }> {
	return new Map(results.map((r) => [r.name, { passed: r.passed, message: r.message }]))
}

describe('RuleSet.run', () => {
	it('runs every rule once and reports pass/fail', async () => {
		const set = new RuleSet<Check>([new Rule('a', pass('a-ok')), new Rule('b', fail('b-bad'))])
		const by = resultsByName(await set.run())
		expect(by.get('a')).toEqual({ passed: true, message: 'a-ok' })
		expect(by.get('b')).toEqual({ passed: false, message: 'b-bad' })
	})

	it('fails a dependent when its dependency fails (dependency evaluated lazily)', async () => {
		// The dependency 'a' is ordered AFTER 'b', so it is evaluated fresh while resolving 'b'.
		const set = new RuleSet<Check>([
			new Rule('b', pass(), { dependencies: ['a'] }),
			new Rule('a', fail('a-bad')),
		])
		const by = resultsByName(await set.run())
		expect(by.get('a')?.passed).toBe(false)
		expect(by.get('b')).toEqual({ passed: false, message: 'Dependency failed: a' })
	})

	it('does NOT auto-fail a dependent when the dependency was already evaluated to a failure (ChipNet quirk, pinned)', async () => {
		// Ordered [a, b]: 'a' is in the memo (failed) before 'b' runs, so the dependency-failed path
		// is skipped and 'b' runs on its own. This is ChipNet's order-dependent behaviour, preserved
		// as-is; see the NOTE in rule.ts. Flagged for the discovery/consensus tickets.
		const set = new RuleSet<Check>([
			new Rule('a', fail('a-bad')),
			new Rule('b', pass('b-ran'), { dependencies: ['a'] }),
		])
		const by = resultsByName(await set.run())
		expect(by.get('b')).toEqual({ passed: true, message: 'b-ran' })
	})

	it('skips a dependent when its dependency was skipped (memoised-skip path)', async () => {
		const set = new RuleSet<Check>([
			new Rule('a', pass(), { condition: () => false }),
			new Rule('b', pass(), { dependencies: ['a'] }),
		])
		const names = (await set.run()).map((r) => r.name)
		expect(names).not.toContain('a')
		expect(names).not.toContain('b')
	})

	it('runs a dependent normally when its dependency passes', async () => {
		const set = new RuleSet<Check>([
			new Rule('a', pass()),
			new Rule('b', pass('b-ran'), { dependencies: ['a'] }),
		])
		const by = resultsByName(await set.run())
		expect(by.get('b')).toEqual({ passed: true, message: 'b-ran' })
	})

	it('fails a dependent naming a dependency that does not exist', async () => {
		const set = new RuleSet<Check>([new Rule('b', pass(), { dependencies: ['ghost'] })])
		const by = resultsByName(await set.run())
		expect(by.get('b')).toEqual({ passed: false, message: 'Missing dependency: ghost' })
	})

	it('skips a rule whose condition is false and omits it from the results', async () => {
		const set = new RuleSet<Check>([
			new Rule('a', pass()),
			new Rule('b', pass(), { condition: () => false }),
		])
		const names = (await set.run()).map((r) => r.name)
		expect(names).toContain('a')
		expect(names).not.toContain('b')
	})

	it('turns a thrown error into a failed result', async () => {
		const set = new RuleSet<Check>([
			new Rule('a', () => Promise.reject(new Error('kaboom'))),
		])
		const by = resultsByName(await set.run())
		expect(by.get('a')).toEqual({ passed: false, message: 'Error: kaboom' })
	})
})

describe('checkRules / runAndCheck', () => {
	it('checkRules throws the joined messages of failed rules', () => {
		expect(() =>
			checkRules([
				{ name: 'a', passed: true, message: 'ok' },
				{ name: 'b', passed: false, message: 'b-bad' },
				{ name: 'c', passed: false, message: 'c-bad' },
			]),
		).toThrow('b-bad\r\nc-bad')
	})

	it('runAndCheck resolves when all rules pass', async () => {
		const set = new RuleSet<Check>([new Rule('a', pass())])
		await expect(set.runAndCheck()).resolves.toBeUndefined()
	})

	it('runAndCheck rejects when a rule fails', async () => {
		const set = new RuleSet<Check>([new Rule('a', fail('nope'))])
		await expect(set.runAndCheck()).rejects.toThrow('nope')
	})
})
