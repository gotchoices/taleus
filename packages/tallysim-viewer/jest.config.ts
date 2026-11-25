import type { JestConfigWithTsJest } from 'ts-jest'

/**
 * Jest over the headless `src/core/**` modules only. These import no browser globals, so the Node test
 * environment is correct; the rendering code added by later tickets is covered by a separate (deferred)
 * headless-WebGL smoke test, not jest. Mirrors the sibling `tallysim` config.
 */
const jestConfig: JestConfigWithTsJest = {
	extensionsToTreatAsEsm: ['.ts'],
	transform: {
		'^.+\\.ts$': ['ts-jest', { useESM: true }],
	},
	moduleNameMapper: {
		// Relative imports carry the compiled ".js" extension (Node ESM); map back to source for ts-jest.
		'^(\\.{1,2}/.*)\\.js$': '$1',
	},
	testEnvironment: 'node',
	verbose: true,
	testMatch: ['<rootDir>/src/**/*.test.ts'],
}

export default jestConfig
