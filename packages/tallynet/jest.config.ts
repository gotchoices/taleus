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
	testMatch: ['<rootDir>/src/**/*.test.ts'],
}

export default jestConfig
