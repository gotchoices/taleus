/**
 * The single palette/theme module every rendering tier draws from, so the graph view (this ticket) and the
 * later replay and sweep views stay visually consistent and re-theme in one place. Light and dark are both
 * **selected** palettes (the dark set is its own steps, not an automatic inversion), and the colours are a
 * colour-blind-safe set — the validated default from the data-viz palette reference, chosen for CVD
 * separation on each surface.
 *
 * ── What encodes what (graph view) ─────────────────────────────────────────────────────────────────
 *   - **Nodes** are drawn in a recessive neutral so they do not compete with the edges, which carry the data.
 *   - **Edges (finite capacity)** use a single-hue blue ramp, light → dark with total capacity — a sequential
 *     scale (thickness carries the same magnitude, a deliberate redundant encoding).
 *   - **Edges (unlimited capacity)** use a distinct violet and a fixed thickness, so an `Infinity` tally never
 *     masquerades as a merely-large finite one (the thickness scale tops out well below it).
 *   - **Highlight** (hover / search selection) is a warm accent that separates from both the blue edges and
 *     the neutral nodes.
 *   - **found** is reserved for the replay ticket's "route found" marks (status green); unused here but part of
 *     the shared palette so replay does not invent a second green.
 *
 * Persistence: the chosen theme is stored in `localStorage` and defaults to the OS `prefers-color-scheme`.
 */

/** The named themes. */
export type ThemeName = 'light' | 'dark'

/** Every colour role the viewer renders with. Positions are theme-independent, so only colours live here. */
export interface Palette {
	/** The theme this palette is for. */
	name: ThemeName
	/** The graph canvas / chart surface. */
	surface: string
	/** The page plane behind the surface (panels, bars). */
	pagePlane: string
	/** Primary text ink. */
	textPrimary: string
	/** Secondary text ink (labels, muted captions). */
	textSecondary: string
	/** Hairline borders between panels. */
	border: string
	/** Node fill — recessive neutral. */
	node: string
	/** Node label ink. */
	nodeLabel: string
	/** The finite-capacity edge ramp, low → high total capacity (sequential, one hue). */
	edgeRamp: readonly [string, string, string]
	/** The distinct style for an edge with an unlimited (`Infinity`) capacity in either direction. */
	edgeUnlimited: string
	/** Hover / search-selection accent, applied to nodes and edges alike. */
	highlight: string
	/** Reserved for the replay ticket's "route found" marks (status good green). */
	found: string
}

/** Light theme — validated against the `#ffffff` surface. */
export const lightPalette: Palette = {
	name: 'light',
	surface: '#ffffff',
	pagePlane: '#f9f9f9',
	textPrimary: '#191919',
	textSecondary: '#666666',
	border: 'rgba(11,11,11,0.10)',
	node: '#666666',
	nodeLabel: '#191919',
	edgeRamp: ['#84b9f3', '#257de0', '#0f4a96'],
	edgeUnlimited: '#6a4ce2',
	highlight: '#f47230',
	found: '#0aac23',
}

/** Dark theme — its own steps, validated against the `#191919` surface. */
export const darkPalette: Palette = {
	name: 'dark',
	surface: '#191919',
	pagePlane: '#0b0b0b',
	textPrimary: '#efefef',
	textSecondary: '#9c9c9c',
	border: 'rgba(255,255,255,0.10)',
	node: '#9c9c9c',
	nodeLabel: '#efefef',
	edgeRamp: ['#1757ac', '#519ced', '#b6d5f8'],
	edgeUnlimited: '#9887ef',
	highlight: '#e76624',
	found: '#0aac23',
}

/** The palette for a theme name. */
export function paletteFor(theme: ThemeName): Palette {
	return theme === 'dark' ? darkPalette : lightPalette
}

const STORAGE_KEY = 'tallysim-viewer:theme'

/** The viewer's starting theme: a stored choice if present, else the OS `prefers-color-scheme`, else light. */
export function initialTheme(): ThemeName {
	const stored = safeGetStored()
	if (stored === 'light' || stored === 'dark') {
		return stored
	}
	if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
		return 'dark'
	}
	return 'light'
}

/** Persist the chosen theme (best-effort — a disabled `localStorage` must not break the app). */
export function storeTheme(theme: ThemeName): void {
	try {
		localStorage.setItem(STORAGE_KEY, theme)
	} catch {
		// localStorage can be disabled/full; theme choice is non-essential, so ignore.
	}
}

/** Read the stored theme, swallowing a disabled/throwing `localStorage`. */
function safeGetStored(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY)
	} catch {
		return null
	}
}
