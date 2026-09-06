/**
 * Route names and their parameters, per `design/specs/mobile/navigation.md`.
 * Route names are also deep-link names: `taleus://screen/TallyView/<id>`.
 */
export type RouteParams = {
	TallyList: undefined
	TallyView: { tallyId: string; counterpartyName?: string }
	TallyHistory: { tallyId: string }
	Attention: undefined
	Position: undefined
}

export type RouteName = keyof RouteParams

/** Which tab a route belongs to, and therefore which stack it pushes onto. */
export const tabForRoute: Record<RouteName, TabName> = {
	TallyList: 'Tallies',
	TallyView: 'Tallies',
	TallyHistory: 'Tallies',
	Attention: 'Attention',
	Position: 'Position',
}

export type TabName = 'Tallies' | 'Attention' | 'Position'

export const tabs: { name: TabName; root: RouteName; labelKey: string }[] = [
	{ name: 'Tallies', root: 'TallyList', labelKey: 'tab.tallies' },
	{ name: 'Attention', root: 'Attention', labelKey: 'tab.attention' },
	{ name: 'Position', root: 'Position', labelKey: 'tab.position' },
]

/** What a screen receives. Mirrors the shape a real navigator would pass. */
export interface ScreenProps<R extends RouteName> {
	route: { name: R; params: RouteParams[R] }
	navigation: {
		navigate<T extends RouteName>(name: T, params?: RouteParams[T]): void
		goBack(): void
	}
}
