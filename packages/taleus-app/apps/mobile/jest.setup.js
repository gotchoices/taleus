/**
 * Make the test runtime match the device before anything else loads.
 *
 * Node has the whole `Intl` surface; Hermes has three constructors. Testing
 * against the richer runtime is how "Waiting 1 days" shipped — every plural
 * resolved correctly in jest and fell back to `_other` on the phone. So the
 * three Hermes lacks are removed here, and then the app's own polyfill module
 * runs, exactly as `index.js` does it.
 *
 * If a test starts failing because one of these is missing, that is the point:
 * the device does not have it either.
 */
for (const missing of ['PluralRules', 'DisplayNames', 'RelativeTimeFormat', 'Locale']) {
	delete Intl[missing]
}

require('./src/i18n/intl')

/**
 * `react-native-localize` reads the platform's language through a native
 * module, which a test runtime does not have. The package ships a mock for
 * exactly this; it answers `en-US`, which is what the reference device reports.
 */
jest.mock('react-native-localize', () => require('react-native-localize/mock'))

/**
 * The QR code draws through `react-native-svg`, whose asset loader needs React Native's asset
 * registry, which a test runtime does not have. A test checks what a code says, not how it is
 * drawn, so it stands in as an element carrying its `value`.
 */
jest.mock('react-native-qrcode-svg', () => {
	const { Text } = require('react-native')
	return ({ value }) => require('react').createElement(Text, { testID: 'qr-code' }, value)
})

// Native keyboard tracking has no place in a test renderer; the library ships its own mock.
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'))
