module.exports = {
	preset: '@react-native/jest-preset',
	// Strips the `Intl` constructors Hermes lacks, then loads the app's polyfills,
	// so a test runs against the runtime the device actually has.
	setupFiles: ['<rootDir>/jest.setup.js'],
	// These ship untranspiled ES modules / TypeScript; the preset's default
	// ignore pattern excludes all of node_modules, so they have to be named.
	transformIgnorePatterns: [
		'node_modules/(?!(?:@?react-native|@react-navigation|@react-native-vector-icons|@formatjs)/)',
	],
	// The icon package `require`s its own .ttf, which jest cannot parse.
	moduleNameMapper: {
		'\\.(ttf|otf|woff2?|png|jpe?g|gif|svg)$': '<rootDir>/__mocks__/fileMock.js',
	},
}
