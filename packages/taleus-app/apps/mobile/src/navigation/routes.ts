import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs'
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'

/**
 * Route names and their parameters, per `design/specs/mobile/navigation.md`.
 * Route names are also deep-link names: `taleus://screen/TallyView/<id>`.
 */
export type TalliesParams = {
	TallyList: undefined
	TallyView: { tallyId: string }
	TallyHistory: { tallyId: string }
	CreateInvitation: undefined
	/** The universal-link landing: `https://sereus.org/taleus/invite/<token>`. */
	ReviewInvitation: { token: string }
}

export type AttentionParams = {
	Attention: undefined
}

/** Outside the tabs, shown until a party exists (`navigation.md` § Sitemap). */
export type OnboardingParams = {
	Welcome: undefined
	ChooseName: undefined
}

export type PositionParams = {
	Position: undefined
}

/** The tabs, each holding a stack of its own. */
export type TabParams = {
	Tallies: NavigatorScreenParams<TalliesParams>
	AttentionTab: NavigatorScreenParams<AttentionParams>
	PositionTab: NavigatorScreenParams<PositionParams>
}

export type RouteParams = TalliesParams & AttentionParams & PositionParams
export type RouteName = keyof RouteParams
export type TabName = keyof TabParams

/** Which tab a route belongs to, and therefore which stack it pushes onto. */
export const tabForRoute: Record<RouteName, TabName> = {
	TallyList: 'Tallies',
	TallyView: 'Tallies',
	TallyHistory: 'Tallies',
	CreateInvitation: 'Tallies',
	ReviewInvitation: 'Tallies',
	Attention: 'AttentionTab',
	Position: 'PositionTab',
}

/**
 * The tab bar. `icon` names an Ionicon; `global/ui.md` requires icon **and**
 * label together, never an icon alone.
 */
export const tabs: { name: TabName; labelKey: string; icon: string; iconActive: string }[] = [
	{ name: 'Tallies', labelKey: 'tab.tallies', icon: 'list-outline', iconActive: 'list' },
	{
		name: 'AttentionTab',
		labelKey: 'tab.attention',
		icon: 'notifications-outline',
		iconActive: 'notifications',
	},
	{ name: 'PositionTab', labelKey: 'tab.position', icon: 'wallet-outline', iconActive: 'wallet' },
]

/** Routes about one named tally — the ones an attention item can point at. */
export type TallyRoute = 'TallyView' | 'TallyHistory'

/**
 * Is this a route the app has, and about a single tally? Attention items name
 * routes from `navigation.md` that later slices will add; until then a caller
 * can fall back rather than navigate into nothing.
 */
export function isTallyRoute(name: string): name is TallyRoute {
	return name === 'TallyView' || name === 'TallyHistory'
}

/**
 * What a screen receives. Composite because every screen sits in a stack inside
 * a tab, and `Attention` navigates across tabs into `TallyView`.
 */
export type TalliesScreenProps<R extends keyof TalliesParams> = CompositeScreenProps<
	NativeStackScreenProps<TalliesParams, R>,
	BottomTabScreenProps<TabParams>
>

interface ScreenPropsByRoute {
	TallyList: TalliesScreenProps<'TallyList'>
	TallyView: TalliesScreenProps<'TallyView'>
	TallyHistory: TalliesScreenProps<'TallyHistory'>
	CreateInvitation: TalliesScreenProps<'CreateInvitation'>
	ReviewInvitation: TalliesScreenProps<'ReviewInvitation'>
	Attention: CompositeScreenProps<
		NativeStackScreenProps<AttentionParams, 'Attention'>,
		BottomTabScreenProps<TabParams>
	>
	Position: CompositeScreenProps<
		NativeStackScreenProps<PositionParams, 'Position'>,
		BottomTabScreenProps<TabParams>
	>
}

export type ScreenProps<R extends RouteName> = ScreenPropsByRoute[R]

export type OnboardingProps<R extends keyof OnboardingParams> = NativeStackScreenProps<
	OnboardingParams,
	R
>
