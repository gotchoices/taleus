import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { diskFixtures, FIXTURE_DIR } from '../test-fixtures.js'
import type { TaleusModel } from '../model.js'
import { createMockModel } from './index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const VARIANTS = ['happy', 'empty', 'error', 'first-run', 'naming', 'expired', 'superseded', 'closing']

describe('the mock model', () => {
	it('asks only for fixtures that exist', () => {
		const asked = new Set<string>()
		for (const file of readdirSync(here).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
			for (const m of readFileSync(path.join(here, file), 'utf8').matchAll(/fixture\('([\w.-]+)'\)/g)) {
				asked.add(m[1])
			}
		}
		expect(asked.size).toBeGreaterThan(30)
		const missing = [...asked].filter(name => !existsSync(path.join(FIXTURE_DIR, `${name}.json`)))
		expect(missing).toEqual([])
	})

	it.each(VARIANTS)('answers every argument-free read under the %s variant without throwing', async variant => {
		const { model, controls } = createMockModel(diskFixtures)
		controls.setVariant(variant)
		controls.reset()
		let reads = 0
		for (const [name, namespace] of Object.entries(model) as [keyof TaleusModel, Record<string, unknown>][]) {
			for (const [op, fn] of Object.entries(namespace)) {
				if (typeof fn !== 'function' || fn.length !== 0 || !/^(read|list)/.test(op)) continue
				const result = (await (fn as () => Promise<unknown>)()) as { ok?: boolean }
				expect([`${name}.${op}`, typeof result?.ok]).toEqual([`${name}.${op}`, 'boolean'])
				reads++
			}
		}
		expect(reads).toBeGreaterThan(10)
	})

	it('forgets one namespace’s writes without touching another’s', async () => {
		const { model, controls } = createMockModel(diskFixtures)
		controls.setVariant('happy')
		controls.reset()
		const first = await model.attention.listAttention()
		if (!first.ok || first.value.length === 0) throw new Error('happy attention fixture is empty')
		const id = first.value[0].id
		await model.attention.setAside(id)
		expect(model.attention.wasSetAside(id)).toBe(true)

		controls.reset('tally')
		expect(model.attention.wasSetAside(id)).toBe(true)
		controls.reset('attention')
		expect(model.attention.wasSetAside(id)).toBe(false)
	})
})
