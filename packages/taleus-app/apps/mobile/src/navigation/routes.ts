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
	/** One entry, on its own — story 24 path C. */
	EntryDetail: { tallyId: string; entryId: string }
	/** Terms in force, how they got there, and the contract behind them. */
	TallyTerms: { tallyId: string }
	CreateInvitation: undefined
	/** The universal-link landing: `https://sereus.org/taleus/invite/<token>`. */
	ReviewInvitation: { token: string }
	ReviewOffer: { tallyId: string }
	/**
	 * `amount` and `answers` are how a request hands its figure over: story 22
	 * step 3 — the amount is the requester's, the payer is answering rather than
	 * deciding one.
	 */
	PayPartner: { tallyId: string; amount?: number; answers?: string }
	CreateRequest: { tallyId: string }
	RequestView: { requestId: string }
	CloseTally: { tallyId: string }
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
	/** What units are worth to this party — `navigation.md` puts it under POSITION. */
	ExchangeRates: undefined
}

export type SettingsParams = {
	Settings: undefined
	Profile: undefined
	/** What passed between this party and one counterparty (story 11). */
	DisclosureView: { tallyId: string }
}

/** The tabs, each holding a stack of its own. */
export type TabParams = {
	Tallies: NavigatorScreenParams<TalliesParams>
	AttentionTab: NavigatorScreenParams<AttentionParams>
	PositionTab: NavigatorScreenParams<PositionParams>
	SettingsTab: NavigatorScreenParams<SettingsParams>
}

export type RouteParams = TalliesParams & AttentionParams & PositionParams & SettingsParams
export type RouteName = keyof RouteParams
export type TabName = keyof TabParams

/** Which tab a route belongs to, and therefore which stack it pushes onto. */
export const tabForRoute: Record<RouteName, TabName> = {
	TallyList: 'Tallies',
	TallyView: 'Tallies',
	TallyHistory: 'Tallies',
	EntryDetail: 'Tallies',
	TallyTerms: 'Tallies',
	CreateInvitation: 'Tallies',
	ReviewInvitation: 'Tallies',
	ReviewOffer: 'Tallies',
	PayPartner: 'Tallies',
	CreateRequest: 'Tallies',
	RequestView: 'Tallies',
	CloseTally: 'Tallies',
	Attention: 'AttentionTab',
	Position: 'PositionTab',
	ExchangeRates: 'PositionTab',
	Settings: 'SettingsTab',
	Profile: 'SettingsTab',
	DisclosureView: 'SettingsTab',
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
	{
		name: 'SettingsTab',
		labelKey: 'tab.settings',
		icon: 'settings-outline',
		iconActive: 'settings',
	},
]

/** Routes about one named tally — the ones an attention item can point at. */
export type TallyRoute =
	| 'TallyView'
	| 'TallyHistory'
	| 'TallyTerms'
	| 'ReviewOffer'
	| 'PayPartner'
	| 'CreateRequest'
	| 'CloseTally'

/**
 * Is this a route the app has, and about a single tally? Attention items name
 * routes from `navigation.md` that later slices will add; until then a caller
 * can fall back rather than navigate into nothing.
 */
export function isTallyRoute(name: string): name is TallyRoute {
	return (
		name === 'TallyView' ||
		name === 'TallyHistory' ||
		name === 'TallyTerms' ||
		name === 'ReviewOffer' ||
		name === 'PayPartner' ||
		name === 'CreateRequest' ||
		name === 'CloseTally'
	)
}

/**
 * What a screen receives. Composite because every screen sits in a stack inside
 * a tab, and `Attention` navigates across tabs into `TallyView`.
 */
export type TalliesScreenProps<R extends keyof TalliesParams> = CompositeScreenProps<
	NativeStackScreenProps<TalliesParams, R>,
	BottomTabScreenProps<TabParams>
>

export type SettingsScreenProps<R extends keyof SettingsParams> = CompositeScreenProps<
	NativeStackScreenProps<SettingsParams, R>,
	BottomTabScreenProps<TabParams>
>

interface ScreenPropsByRoute {
	TallyList: TalliesScreenProps<'TallyList'>
	TallyView: TalliesScreenProps<'TallyView'>
	TallyHistory: TalliesScreenProps<'TallyHistory'>
	EntryDetail: TalliesScreenProps<'EntryDetail'>
	TallyTerms: TalliesScreenProps<'TallyTerms'>
	CreateInvitation: TalliesScreenProps<'CreateInvitation'>
	ReviewInvitation: TalliesScreenProps<'ReviewInvitation'>
	ReviewOffer: TalliesScreenProps<'ReviewOffer'>
	PayPartner: TalliesScreenProps<'PayPartner'>
	CreateRequest: TalliesScreenProps<'CreateRequest'>
	RequestView: TalliesScreenProps<'RequestView'>
	CloseTally: TalliesScreenProps<'CloseTally'>
	Attention: CompositeScreenProps<
		NativeStackScreenProps<AttentionParams, 'Attention'>,
		BottomTabScreenProps<TabParams>
	>
	Position: CompositeScreenProps<
		NativeStackScreenProps<PositionParams, 'Position'>,
		BottomTabScreenProps<TabParams>
	>
	ExchangeRates: CompositeScreenProps<
		NativeStackScreenProps<PositionParams, 'ExchangeRates'>,
		BottomTabScreenProps<TabParams>
	>
	Settings: SettingsScreenProps<'Settings'>
	Profile: SettingsScreenProps<'Profile'>
	DisclosureView: SettingsScreenProps<'DisclosureView'>
}

export type ScreenProps<R extends RouteName> = ScreenPropsByRoute[R]

export type OnboardingProps<R extends keyof OnboardingParams> = NativeStackScreenProps<
	OnboardingParams,
	R
>
