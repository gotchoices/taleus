import { createContext, useContext, useMemo, useState } from 'react'
import { StyleSheet, useColorScheme } from 'react-native'

import { dark, light, type Tokens } from './tokens'

/**
 * Theme as a hook, not a per-screen ternary.
 *
 * `global/ui.md` makes the theme user-selectable (system | light | dark), which
 * a bare `useColorScheme()` cannot express. The choice lives here so the
 * settings screen (story 42) has somewhere to put it, and so screens keep
 * asking one question: what are my tokens?
 */
export type ThemeChoice = 'system' | 'light' | 'dark'

interface ThemeValue {
	tokens: Tokens
	choice: ThemeChoice
	setChoice(choice: ThemeChoice): void
	isDark: boolean
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
	const system = useColorScheme()
	const [choice, setChoice] = useState<ThemeChoice>('system')
	const isDark = choice === 'system' ? system === 'dark' : choice === 'dark'
	const value = useMemo(
		() => ({ tokens: isDark ? dark : light, choice, setChoice, isDark }),
		[isDark, choice],
	)
	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
	const value = useContext(ThemeContext)
	if (!value) {
		throw new Error('useTheme outside ThemeProvider')
	}
	return value
}

export function useTokens(): Tokens {
	return useTheme().tokens
}

/**
 * Styles built once per token set rather than once per render — `TallyRow` was
 * calling `StyleSheet.create` for every row on the list.
 */
export function useStyles<T extends StyleSheet.NamedStyles<T>>(factory: (tokens: Tokens) => T): T {
	const tokens = useTokens()
	return useMemo(() => StyleSheet.create(factory(tokens)), [tokens, factory])
}

export * from './tokens'
