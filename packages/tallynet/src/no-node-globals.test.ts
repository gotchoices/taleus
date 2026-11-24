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
