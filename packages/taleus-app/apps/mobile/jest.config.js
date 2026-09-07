module.exports = {
	preset: '@react-native/jest-preset',
	// These ship untranspiled ES modules / TypeScript; the preset's default
	// ignore pattern excludes all of node_modules, so they have to be named.
	transformIgnorePatterns: [
		'node_modules/(?!(?:@?react-native|@react-navigation|@react-native-vector-icons)/)',
	],
	// The icon package `require`s its own .ttf, which jest cannot parse.
	moduleNameMapper: {
		'\\.(ttf|otf|woff2?|png|jpe?g|gif|svg)$': '<rootDir>/__mocks__/fileMock.js',
	},
}
