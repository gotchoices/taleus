/**
 * Taleus mobile.
 *
 * One screen for now: the tally list is the launch route once a party exists
 * (`design/specs/mobile/navigation.md`). Navigation arrives with the slice that
 * introduces a second screen.
 */
import { StatusBar, useColorScheme } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'

import { TallyList } from './src/screens/TallyList'
import { dark, light } from './src/theme/tokens'

function App(): React.JSX.Element {
	const isDark = useColorScheme() === 'dark'
	const tokens = isDark ? dark : light

	return (
		<SafeAreaProvider>
			<StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
			<SafeAreaView style={{ flex: 1, backgroundColor: tokens.background }}>
				<TallyList />
			</SafeAreaView>
		</SafeAreaProvider>
	)
}

export default App
