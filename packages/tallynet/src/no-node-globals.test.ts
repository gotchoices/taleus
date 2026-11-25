import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * TallyNet must run unchanged in Node, the browser and React Native. This guards that at the source
 * level: no `Buffer`, no `node:` imports, no bare Node built-in imports (`crypto`, `fs`, …), no
 * `require`. The platform-neutral build (`tsconfig.build.json`, `types: []`) already refuses
 * `Buffer` at compile time; this makes the rule explicit and catches imports the type layer would
 * miss. The Web Crypto *global* (`crypto.getRandomValues`) is allowed — it is not an import.
 */

const SRC_DIR = join(process.cwd(), 'src')

const NODE_BUILTINS = [
	'crypto', 'fs', 'path', 'os', 'util', 'stream', 'buffer', 'events',
	'child_process', 'http', 'https', 'net', 'tls', 'url', 'zlib',
]

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
	// Match Node `Buffer` *usage* (`Buffer.from`, `new Buffer(`) rather than the bare word, so a
	// comment that names it in prose is not a false positive. The `types: []` build already refuses
	// it at compile time; this is the belt-and-suspenders grep the ticket asks for.
	{ pattern: /\bBuffer\s*[.(]/, why: 'Buffer is Node-only; use Uint8Array' },
	{ pattern: /\brequire\s*\(/, why: 'CommonJS require; this package is ESM' },
	{ pattern: /from\s+['"]node:/, why: "node: imports are Node-only" },
	{ pattern: new RegExp(`from\\s+['"](${NODE_BUILTINS.join('|')})['"]`), why: 'bare Node built-in import' },
]

/**
 * The injected-port rules: TallyNet reads all time, all timers and all randomness through a
 * `Clock`/`RandomSource`, never a raw global. Like the Buffer rule, each pattern matches the
 * **call** form (`Date.now(`, `setTimeout(`) so a comment that merely names the symbol in prose is
 * not a false positive. `allow` lists the exact `src/`-relative paths permitted to contain it:
 * `clock.ts` owns the real-time clock (and the local `setTimeout`/`clearTimeout` declarations), so
 * it is the sole allowlisted file for the timer/`Date.now` set; `Math.random` is allowlisted
 * nowhere (randomness always comes from an injected `RandomSource`).
 *
 * NOTE: this is a greppable guard, not a proof. It catches the direct call form; it does not catch
 * an alias (`const n = Date.now; n()`) or a dynamic lookup (`globalThis['set' + 'Timeout']`). If a
 * future port leak slips through by aliasing, tighten this rule or switch to an AST lint rule.
 */
interface PortRule {
	pattern: RegExp
	why: string
	allow: string[]
}

const PORT_RULES: PortRule[] = [
	{ pattern: /\bDate\.now\s*\(/, why: 'read time through a Clock, not Date.now', allow: ['clock.ts'] },
	{ pattern: /\bsetTimeout\s*\(/, why: 'arm timers through a Clock, not setTimeout', allow: ['clock.ts'] },
	{ pattern: /\bclearTimeout\s*\(/, why: 'clear timers through a Clock, not clearTimeout', allow: ['clock.ts'] },
	{ pattern: /\bsetInterval\s*\(/, why: 'arm timers through a Clock, not setInterval', allow: ['clock.ts'] },
	{ pattern: /\bclearInterval\s*\(/, why: 'clear timers through a Clock, not clearInterval', allow: ['clock.ts'] },
	{ pattern: /\bMath\.random\s*\(/, why: 'randomness comes from an injected RandomSource, not Math.random', allow: [] },
]

/** The first injected-port rule `source` violates (given its `src/`-relative path), or `null`. */
function portViolation(relativePath: string, source: string): { match: string; why: string } | null {
	const path = relativePath.replace(/\\/g, '/')
	for (const { pattern, why, allow } of PORT_RULES) {
		if (allow.includes(path)) {
			continue
		}
		const match = pattern.exec(source)
		if (match) {
			return { match: match[0], why }
		}
	}
	return null
}

function sourceFiles(): string[] {
	return readdirSync(SRC_DIR, { recursive: true })
		.map((entry) => String(entry))
		.filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
}

describe('platform neutrality (src/)', () => {
	it('has source files to scan', () => {
		expect(sourceFiles().length).toBeGreaterThan(0)
	})

	it.each(sourceFiles())('%s uses no Node-only globals or imports', (relativePath) => {
		const source = readFileSync(join(SRC_DIR, relativePath), 'utf8')
		for (const { pattern, why } of FORBIDDEN) {
			expect({ file: relativePath, match: pattern.exec(source)?.[0] ?? null, why }).toEqual({
				file: relativePath,
				match: null,
				why,
			})
		}
	})
})

describe('injected ports (src/)', () => {
	it.each(sourceFiles())(
		'%s reads time, timers and randomness only through the injected ports',
		(relativePath) => {
			const source = readFileSync(join(SRC_DIR, relativePath), 'utf8')
			expect({ file: relativePath, violation: portViolation(relativePath, source) }).toEqual({
				file: relativePath,
				violation: null,
			})
		},
	)

	it('flags a real Date.now( call outside clock.ts', () => {
		expect(portViolation('sequencing.ts', 'const t = Date.now()')).toEqual({
			match: 'Date.now(',
			why: 'read time through a Clock, not Date.now',
		})
	})

	it('flags a raw setTimeout( / clearTimeout( outside clock.ts', () => {
		expect(portViolation('sequencing.ts', 'const h = setTimeout(fn, 10)')?.match).toBe('setTimeout(')
		expect(portViolation('sequencing.ts', 'clearTimeout(h)')?.match).toBe('clearTimeout(')
	})

	it('allows Date.now( and the timer globals inside clock.ts', () => {
		expect(portViolation('clock.ts', 'now: () => Date.now(), s: () => setTimeout(f, 1), c: () => clearTimeout(h)')).toBeNull()
	})

	it('flags Math.random( everywhere, allowlisting nothing — even clock.ts', () => {
		expect(portViolation('clock.ts', 'const r = Math.random()')?.match).toBe('Math.random(')
		expect(portViolation('nonce.ts', 'const r = Math.random()')?.match).toBe('Math.random(')
	})

	it('does not false-positive on a comment that names the symbols in prose (no call parens)', () => {
		expect(portViolation('sequencing.ts', '// nothing here reads Date.now or arms a setTimeout')).toBeNull()
	})
})
