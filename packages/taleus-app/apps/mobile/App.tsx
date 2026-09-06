/**
 * Taleus mobile.
 *
 * Navigation, deep links, and the tab set live in `src/navigation/`, derived
 * from `design/specs/mobile/navigation.md`.
 */
import { StatusBar, useColorScheme } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { AppNavigator } from './src/navigation'

function App(): React.JSX.Element {
	const isDark = useColorScheme() === 'dark'

	return (
		<SafeAreaProvider>
			<StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
			<AppNavigator />
		</SafeAreaProvider>
	)
}

export default App
