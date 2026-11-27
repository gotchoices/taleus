import type { JestConfigWithTsJest } from 'ts-jest'

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
	// The consensus harness drives the real tallynet protocol with ed25519 keygen per query, and the
	// pull-recovery / determinism cases replay whole sweeps; standalone each is a few seconds, but under the
	// full-suite parallel load they exceed Jest's 5 s default and time out. Give every test generous headroom
	// (still short enough to catch a genuine hang — the pull pass is bounded by `members.length` rounds).
	testTimeout: 30000,
	testMatch: ['<rootDir>/src/**/*.test.ts'],
}

export default jestConfig
