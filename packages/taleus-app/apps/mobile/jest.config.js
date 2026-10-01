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
	// The fixtures in `mock/data` carry fixed dates, written as if today were 7 September 2026
	// -- an expiry "in 4 days", a reduction "not yet in force", a device "not carried in months".
	// Against the real clock those rot: four tests went red simply because the calendar moved.
	// Only `Date` is faked; every timer stays real, so async rendering is untouched.
	fakeTimers: {
		enableGlobally: true,
		now: Date.parse('2026-09-07T12:00:00Z'),
		doNotFake: [
			'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
			'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
			'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
		],
	},
	// `taleus-model` is linked in from outside this project, so the helpers Babel
	// injects into it (`@babel/runtime/...`) would be looked for beside its real
	// path, where they are not installed. Fall back to this app's node_modules.
	modulePaths: ['<rootDir>/node_modules'],
	// The icon package `require`s its own .ttf, which jest cannot parse.
	moduleNameMapper: {
		'\\.(ttf|otf|woff2?|png|jpe?g|gif|svg)$': '<rootDir>/__mocks__/fileMock.js',
	},
}
