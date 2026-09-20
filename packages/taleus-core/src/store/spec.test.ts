import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { schemaPath } from './schema-node.js'

/**
 * The rules in `SPEC.md` that a machine can check.
 *
 * Prose in a specification decays; a test does not. Each of these has already been violated
 * once in this package's short life, which is the argument for having them at all.
 */

const SRC = join(schemaPath('draft1'), '..', '..', 'src')

function sourceFiles(dir: string): string[] {
	const out: string[] = []
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) {
			out.push(...sourceFiles(full))
		} else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
			out.push(full)
		}
	}
	return out
}

/** Code with comments removed -- a rule is about what runs, not what is explained. */
function codeOf(path: string): string {
	return readFileSync(path, 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '')
}

describe('SPEC § 3 — no platform-specific dependency', () => {
	it('only schema-node.ts imports node:', () => {
		const offenders = sourceFiles(SRC)
			.filter(file => !file.endsWith('schema-node.ts'))
			.filter(file => /from 'node:/.test(codeOf(file)))
		expect(offenders).toEqual([])
	})

	it('nothing uses Buffer', () => {
		// Absent from the browser and from React Native without a polyfill, and the easiest
		// way to break portability without noticing. `Uint8Array` and `TextEncoder` instead.
		const offenders = sourceFiles(SRC).filter(file => /\bBuffer\b/.test(codeOf(file)))
		expect(offenders).toEqual([])
	})
})

describe('SPEC § 5 — deterministic where a replica re-validates', () => {
	it('no schema constraint or default can read a clock or a random source', () => {
		for (const name of ['draft1', 'portfolio'] as const) {
			const sql = readFileSync(schemaPath(name), 'utf8')
				.split('\n')
				.map(line => (line.indexOf('--') === -1 ? line : line.slice(0, line.indexOf('--'))))
				.join('\n')
			expect(sql).not.toMatch(/\bjulianday\s*\(/)
			expect(sql).not.toMatch(/\bRandomUUID\s*\(/)
			// `Today()` is volatile and allowed -- but only in a plain view, never inside a
			// CHECK. Quereus rejects the latter, which is the enforcement; this records it.
			const checks = sql.match(/constraint\s+\w+\s+check[^,]*/gi) ?? []
			for (const check of checks) {
				expect(check).not.toMatch(/\bToday\s*\(/)
			}
		}
	})
})
