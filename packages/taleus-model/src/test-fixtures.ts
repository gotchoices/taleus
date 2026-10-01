import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import type { FixtureSource } from './fixtures.js'

/**
 * The fixtures, read off disk -- the test-side counterpart of the app's map of static
 * `require`s. Excluded from the build: it is Node-only, and the package is not.
 */
export const FIXTURE_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../taleus-app/mock/data',
)

export const diskFixtures: FixtureSource = name =>
	JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8')) as unknown
