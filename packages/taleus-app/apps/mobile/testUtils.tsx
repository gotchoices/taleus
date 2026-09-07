import { render } from '@testing-library/react-native'

import { ThemeProvider } from './src/theme'
import type { RouteName, RouteParams, ScreenProps } from './src/navigation/routes'

/**
 * Screens read their tokens from context, so tests have to supply it.
 * `render` is asynchronous in RNTL 14 — awaiting it is not optional.
 */
export function renderScreen(element: React.ReactElement) {
	return render(<ThemeProvider>{element}</ThemeProvider>)
}

/**
 * The `{ route, navigation }` pair React Navigation would pass, with only the
 * parts a screen actually touches. Casting once here beats casting at every
 * call site, and keeps the screens' real prop types honest.
 */
export function screenProps<R extends RouteName>(
	name: R,
	params: RouteParams[R],
	navigate: jest.Mock = jest.fn(),
): ScreenProps<R> {
	return {
		route: { key: `${name}-test`, name, params },
		navigation: { navigate, goBack: jest.fn(), setOptions: jest.fn() },
	} as unknown as ScreenProps<R>
}
