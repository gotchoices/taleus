/**
 * Semantic tokens from `design/specs/mobile/global/ui.md`. Screens reference
 * these by name; no screen carries a raw colour.
 */
export interface Tokens {
	background: string
	surface: string
	surfaceAlt: string
	textPrimary: string
	textSecondary: string
	border: string
	accent: string
	accentText: string
	positive: string
	negative: string
	bannerError: string
}

export const light: Tokens = {
	background: '#ffffff',
	surface: '#ffffff',
	surfaceAlt: '#f3f4f8',
	textPrimary: '#111111',
	textSecondary: '#555555',
	border: '#e2e2e2',
	accent: '#4a3fbf',
	accentText: '#ffffff',
	positive: '#1a7f5a',
	negative: '#b3261e',
	bannerError: '#ffeeee',
}

export const dark: Tokens = {
	background: '#000000',
	surface: '#111111',
	surfaceAlt: '#1b1c24',
	textPrimary: '#eeeeee',
	textSecondary: '#bbbbbb',
	border: '#2a2d31',
	accent: '#8f86f0',
	accentText: '#131033',
	positive: '#37b283',
	negative: '#f2b8b5',
	bannerError: '#330000',
}

export const spacing = [4, 8, 12, 16, 20, 24] as const

export const type = {
	title: { fontSize: 20, fontWeight: '600' as const },
	body: { fontSize: 16, fontWeight: '400' as const },
	small: { fontSize: 12, fontWeight: '400' as const },
}
