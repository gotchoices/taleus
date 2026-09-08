/**
 * Taleus mobile.
 *
 * Navigation, deep links, and the tab set live in `src/navigation/`, derived
 * from `design/specs/mobile/navigation.md`. The theme is a provider rather than
 * a per-screen `useColorScheme()` because `global/ui.md` makes it selectable.
 */
import { StatusBar, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ErrorBoundary } from './src/components/ErrorBoundary'
import { AppNavigator } from './src/navigation'
import { SessionProvider } from './src/session'
import { ThemeProvider, useTheme } from './src/theme'

function Themed(): React.JSX.Element {
	const { tokens, isDark } = useTheme()
	return (
		<View style={{ flex: 1, backgroundColor: tokens.background }}>
			{/* No backgroundColor: React Native 0.87 draws edge-to-edge, so the bar is
			    transparent and the view beneath it supplies the colour. */}
			<StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
			<ErrorBoundary>
				<AppNavigator />
			</ErrorBoundary>
		</View>
	)
}

function App(): React.JSX.Element {
	return (
		<SafeAreaProvider>
			<ThemeProvider>
				<SessionProvider>
					<Themed />
				</SessionProvider>
			</ThemeProvider>
		</SafeAreaProvider>
	)
}

export default App
