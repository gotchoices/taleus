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
 *   - **found** is the replay's "route found" mark (status green); on the shared palette so replay does not
 *     invent a second green.
 *
 * ── What encodes what (replay tier) ────────────────────────────────────────────────────────────────
 *   - **roundScale** is a sequential, ordinal ramp (~6 steps) for *how far out* the search has reached: a lit
 *     node/edge is coloured by its round. It is a **warm** ramp (indigo→amber light, violet→yellow dark) on
 *     purpose — it must separate from the cool-blue capacity edges and neutral nodes it is painted over. Each
 *     theme has its own steps, chosen for contrast on that surface (the dark steps are brighter, not inverted).
 *     Rounds past the last step clamp to it.
 *   - **pruned** is the fade a dropped candidate edge takes — a muted rose, deliberately *not* the blue of a
 *     never-reached edge, so "explored then discarded" reads differently from "never touched".
 *   - **sleeping** (a node that never answers) and **late** (a node that answers only after a long delay) are
 *     two distinct dim marks — slate for asleep, gold for late — so the two conditions are told apart. They are
 *     markers only; they carry no "the query failed" meaning (a sleeping *target* can still be resolved by a
 *     neighbour).
 *   - **dimmed** is the recede colour for everything *outside* a selected (isolated) route — near the surface,
 *     so the isolated route stands alone.
 *   - **promised / committed / voidFlash** animate a lift's sign-and-settle phase (the consensus overlay): a
 *     teal/cyan **promised** as a record is pushed over a hop, a solid green **committed** when the whole route
 *     settles, and a crimson **voidFlash** for a brief flash as a voided lift lets its held hops go (and on a
 *     no-commit vote). The triad is chosen to separate from the other roles (blue capacity edges, warm
 *     roundScale, violet unlimited, rose pruned) and from each other; its one colour-blind-risky pair —
 *     committed (green) vs voidFlash (red) — never co-occurs (commit XOR void) and is backed by the
 *     found-routes outcome **badge** text, so colour is never the sole channel.
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
	/** The replay's "route found" mark (status good green). */
	found: string
	/**
	 * The replay round ramp: a sequential ordinal scale (~6 steps) a lit node/edge is coloured by its round.
	 * Warm, so it separates from the blue capacity edges; a round past the last index clamps to the last step.
	 */
	roundScale: readonly string[]
	/** The fade a pruned (dropped) candidate edge takes — distinct from a never-reached (blue) edge. */
	pruned: string
	/** A node made to sleep (never answers): a distinct dim mark, told apart from {@link Palette.late}. */
	sleeping: string
	/** A node made late (answers only after a long delay): a distinct dim mark, told apart from `sleeping`. */
	late: string
	/** The recede colour for items outside a selected (isolated) route, so the route stands alone. */
	dimmed: string
	/** A hop with a promise in flight (a record pushed over it, not yet settled): teal/cyan, distinct from blue. */
	promised: string
	/** A hop (and node) of a committed lift — the whole route reads solid: a success green, its own step. */
	committed: string
	/** The brief flash a voided lift's held hops take as they clear, and a no-commit vote's node: a crimson red. */
	voidFlash: string
	/**
	 * The sweep charts' categorical series colours — one per plotted line. The data-viz reference's eight-hue
	 * categorical set in its validated order (the ordering is the colour-blind-safety mechanism, not cosmetic);
	 * each theme has its own steps for its surface. More than eight series cycle the set (a dev tool; a line
	 * chart uses the adjacent-pair gate, which all eight clear).
	 */
	seriesScale: readonly string[]
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
	// Warm indigo→amber; all steps clear a legible contrast on white (lightest amber reads as a mark, not text).
	roundScale: ['#5e1687', '#8c2981', '#b73779', '#d9586b', '#ef7f4f', '#f3a93b'],
	pruned: '#c49ca2',
	sleeping: '#8a94a6',
	late: '#b98f36',
	dimmed: '#dddddd',
	// Consensus triad (light): cyan promise → solid green commit → crimson void flash. Committed is a touch
	// deeper than `found` (#0aac23) so the two greens are not identical where both could show.
	promised: '#0e9fb8',
	committed: '#0a8f3c',
	voidFlash: '#d81e3f',
	// Categorical slots 1–8 (blue, orange, aqua, yellow, magenta, green, violet, red), light column.
	seriesScale: ['#257de0', '#f47230', '#00b894', '#f2a600', '#ee7fac', '#008a17', '#6a4ce2', '#ec4647'],
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
	// Brighter warm violet→yellow; its own steps (not an inversion), all legible on the dark surface.
	roundScale: ['#9c4bd4', '#c65b9f', '#e36d7b', '#f28a4c', '#f6b73c', '#f5e04a'],
	pruned: '#6e5156',
	sleeping: '#6b7585',
	late: '#b9923f',
	dimmed: '#333333',
	// Consensus triad (dark): brighter steps for the #191919 surface, its own values (not an inversion).
	promised: '#34c0d6',
	committed: '#2bb14e',
	voidFlash: '#f0506a',
	// The same eight hues stepped for the dark surface (data-viz reference's dark column).
	seriesScale: ['#338ced', '#e76624', '#00a888', '#d28e05', '#e24d8b', '#0aac23', '#9887ef', '#eb6263'],
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
