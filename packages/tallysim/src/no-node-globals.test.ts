import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * TallySim must run unchanged in Node and the browser (the viewer runs simulations live in a page). This
 * guards that at the source level over the neutral core (`src/`, minus tests and the future Node-only
 * `src/cli/`): no `Buffer`, no `node:` imports, no bare Node built-in imports, no `require`. It also
 * enforces the determinism rule: no `Math.random` (randomness always comes from the injected `SeededRandom`)
 * and no wall-clock/timer globals (`Date.now`, `setTimeout`, …), which would make a run non-reproducible.
 * The platform-neutral build (`tsconfig.build.json`, `types: []`) already refuses `Buffer`; this makes the
 * rule explicit and catches imports the type layer would miss.
 *
 * Each pattern matches the **call/usage** form (`Buffer.from`, `Math.random(`, `Date.now(`) so a comment
 * that merely names a symbol in prose is not a false positive.
 *
 * NOTE: this is a greppable guard, not a proof. It catches the direct form; it does not catch an alias
 * (`const r = Math.random; r()`) or a dynamic lookup. If a future leak slips through by aliasing, tighten
 * this rule or switch to an AST lint rule.
 */

const SRC_DIR = join(process.cwd(), 'src')

const NODE_BUILTINS = [
	'crypto', 'fs', 'path', 'os', 'util', 'stream', 'buffer', 'events',
	'child_process', 'http', 'https', 'net', 'tls', 'url', 'zlib',
]

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
	{ pattern: /\bBuffer\s*[.(]/, why: 'Buffer is Node-only; use Uint8Array' },
	{ pattern: /\brequire\s*\(/, why: 'CommonJS require; this package is ESM' },
	{ pattern: /from\s+['"]node:/, why: "node: imports are Node-only" },
	{ pattern: new RegExp(`from\\s+['"](${NODE_BUILTINS.join('|')})['"]`), why: 'bare Node built-in import' },
	{ pattern: /\bMath\.random\s*\(/, why: 'randomness comes from the injected SeededRandom, not Math.random' },
	{ pattern: /\bDate\.now\s*\(/, why: 'no wall clock in a deterministic sim; do not read Date.now' },
	{ pattern: /\bsetTimeout\s*\(/, why: 'no timers in a deterministic sim' },
	{ pattern: /\bsetInterval\s*\(/, why: 'no timers in a deterministic sim' },
]

/** Non-test `src/` files, as `src/`-relative paths, excluding the future Node-only `src/cli/`. */
function sourceFiles(): string[] {
	return readdirSync(SRC_DIR, { recursive: true })
		.map((entry) => String(entry).replace(/\\/g, '/'))
		.filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.startsWith('cli/'))
}

/** The first forbidden pattern `source` matches, or `null`. Exposed for the guard's own self-tests. */
function forbiddenMatch(source: string): { match: string; why: string } | null {
	for (const { pattern, why } of FORBIDDEN) {
		const match = pattern.exec(source)
		if (match) {
			return { match: match[0], why }
		}
	}
	return null
}

describe('platform neutrality (src/)', () => {
	it('has source files to scan', () => {
		expect(sourceFiles().length).toBeGreaterThan(0)
	})

	it.each(sourceFiles())('%s uses no Node-only globals/imports or non-deterministic globals', (relativePath) => {
		const source = readFileSync(join(SRC_DIR, relativePath), 'utf8')
		expect({ file: relativePath, violation: forbiddenMatch(source) }).toEqual({
			file: relativePath,
			violation: null,
		})
	})

	it('flags a real Math.random( call', () => {
		expect(forbiddenMatch('const r = Math.random()')).toEqual({
			match: 'Math.random(',
			why: 'randomness comes from the injected SeededRandom, not Math.random',
		})
	})

	it('flags a Buffer usage and a node: import', () => {
		expect(forbiddenMatch('const b = Buffer.from([1])')?.match).toBe('Buffer.')
		expect(forbiddenMatch("import { readFileSync } from 'node:fs'")?.match).toBe("from 'node:")
	})

	it('does not false-positive on a comment that names the symbols in prose (no call parens)', () => {
		expect(forbiddenMatch('// nothing here calls Math.random or Date.now or a Buffer')).toBeNull()
	})
})
