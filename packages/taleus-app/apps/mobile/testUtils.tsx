import { render } from '@testing-library/react-native'

import { ThemeProvider } from './src/theme'

/**
 * Screens read their tokens from context now, so tests have to supply it.
 * `render` is asynchronous in RNTL 14 — awaiting it is not optional.
 */
export function renderScreen(element: React.ReactElement) {
	return render(<ThemeProvider>{element}</ThemeProvider>)
}

export const noNavigation = { navigate: jest.fn(), goBack: jest.fn() }
