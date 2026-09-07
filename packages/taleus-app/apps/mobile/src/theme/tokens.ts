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
	/** Fill behind a chip that is merely stating a state. */
	chip: string
	/** Fill behind a chip that is a demand on this party. */
	chipUrgent: string
	chipUrgentText: string
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
	chip: '#e6e7ef',
	chipUrgent: '#4a3fbf',
	chipUrgentText: '#ffffff',
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
	chip: '#2a2c38',
	chipUrgent: '#8f86f0',
	chipUrgentText: '#131033',
}

export const spacing = [4, 8, 12, 16, 20, 24] as const

export const type = {
	title: { fontSize: 20, fontWeight: '600' as const },
	body: { fontSize: 16, fontWeight: '400' as const },
	/** The explanatory lines that teach. Read every visit — not metadata size. */
	caption: { fontSize: 14, fontWeight: '400' as const },
	/** Metadata only: dates, who signed, ageing. */
	small: { fontSize: 12, fontWeight: '400' as const },
}

/** Platform minimum for anything tappable (`global/ui.md` § Interaction). */
export const touchTarget = 48
