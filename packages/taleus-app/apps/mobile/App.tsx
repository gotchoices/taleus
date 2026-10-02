/**
 * Taleus mobile.
 *
 * Navigation, deep links, and the tab set live in `src/navigation/`, derived
 * from `design/specs/mobile/navigation.md`. The theme is a provider rather than
 * a per-screen `useColorScheme()` because `global/ui.md` makes it selectable.
 */
import { useEffect, useState } from 'react'
import { StatusBar, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Loading } from './src/components'
import { ErrorBoundary } from './src/components/ErrorBoundary'
import { modelStarted, startModel } from './src/data/config'
import { useStoredPreferences } from './src/hooks/usePreferences'
import { AppNavigator } from './src/navigation'
import { SessionProvider } from './src/session'
import { ThemeProvider, useTheme } from './src/theme'

function Themed(): React.JSX.Element {
	const { tokens, isDark } = useTheme()
	const ready = useStoredPreferences()
	return (
		<View style={{ flex: 1, backgroundColor: tokens.background }}>
			{/* No backgroundColor: React Native 0.87 draws edge-to-edge, so the bar is
			    transparent and the view beneath it supplies the colour. */}
			<StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
			<ErrorBoundary>{ready ? <AppNavigator /> : <Loading />}</ErrorBoundary>
		</View>
	)
}

/**
 * Nothing reads before the model is up. In mock mode it already is, so this
 * renders straight through; in engine mode it waits for the engine to start.
 */
function ModelGate({ children }: { children: React.ReactNode }): React.JSX.Element {
	const [ready, setReady] = useState(modelStarted)
	const [failure, setFailure] = useState<Error>()
	useEffect(() => {
		if (!ready) {
			void startModel().then(
				() => setReady(true),
				(error: unknown) => setFailure(error instanceof Error ? error : new Error(String(error))),
			)
		}
	}, [ready])
	if (failure) throw failure
	return ready ? <>{children}</> : <Loading />
}

function App(): React.JSX.Element {
	return (
		<SafeAreaProvider>
			<ThemeProvider>
				<ErrorBoundary>
					<ModelGate>
						<SessionProvider>
							<Themed />
						</SessionProvider>
					</ModelGate>
				</ErrorBoundary>
			</ThemeProvider>
		</SafeAreaProvider>
	)
}

export default App
