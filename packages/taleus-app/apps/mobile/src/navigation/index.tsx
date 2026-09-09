import { useEffect } from 'react'
import Ionicons from '@react-native-vector-icons/ionicons'
import { NavigationContainer, type Theme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Image, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Attention } from '../screens/Attention'
import { ChooseName } from '../screens/ChooseName'
import { CreateInvitation } from '../screens/CreateInvitation'
import { ReviewInvitation } from '../screens/ReviewInvitation'
import { ReviewOffer } from '../screens/ReviewOffer'
import { Welcome } from '../screens/Welcome'
import { Position } from '../screens/Position'
import { TallyHistory } from '../screens/TallyHistory'
import { TallyList } from '../screens/TallyList'
import { TallyView } from '../screens/TallyView'
import { t } from '../i18n'
import { useTokens, type as typography, type Tokens } from '../theme'
import { isOnboarded, useSession } from '../session'
import { Loading } from '../components'
import { linking } from './linking'
import {
	tabs,
	type AttentionParams,
	type OnboardingParams,
	type PositionParams,
	type TabParams,
	type TalliesParams,
} from './routes'

/**
 * Navigation, per `design/specs/mobile/navigation.md`.
 *
 * One stack per tab. React Navigation supplies what the hand-rolled navigator
 * could not: the platform back gesture and Android's hardware back, real
 * transitions, modal routes for `Scan`, and state restoration. It became
 * installable at React Native 0.87 — see `debt-mobile-navigation-library` for
 * why 0.82 could not have it.
 */
const Tallies = createNativeStackNavigator<TalliesParams>()
const AttentionStack = createNativeStackNavigator<AttentionParams>()
const PositionStack = createNativeStackNavigator<PositionParams>()
const Tabs = createBottomTabNavigator<TabParams>()
const Onboarding = createNativeStackNavigator<OnboardingParams>()

/**
 * First run, outside the tabs (`navigation.md` § Sitemap). Shown until there is
 * an identity with a name on it; story 10 is what happens here.
 */
function OnboardingStack(): React.JSX.Element {
	const session = useSession()
	const insets = useSafeAreaInsets()
	return (
		// First run has no header, so nothing else keeps content out from under
		// the status bar — React Native 0.87 draws edge-to-edge.
		<View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}>
		<Onboarding.Navigator screenOptions={{ ...useStackOptions(), headerShown: false }}>
			<Onboarding.Screen name="Welcome" component={Welcome} />
			<Onboarding.Screen name="ChooseName">
				{props => <ChooseName {...props} onDone={session.reload} />}
			</Onboarding.Screen>
		</Onboarding.Navigator>
		</View>
	)
}

/**
 * The one branded corner in the app — the mark on the home header, the way the
 * sibling Sereus apps carry theirs (`global/ui.md` § Brand mark). Decorative only.
 */
function HeaderLogo(): React.JSX.Element {
	return (
		<Image
			source={require('../assets/logo.png')}
			style={styles.headerLogo}
			accessibilityRole="image"
			accessibilityLabel="Taleus"
		/>
	)
}

const styles = StyleSheet.create({
	headerLogo: { width: 26, height: 26, marginRight: 8, resizeMode: 'contain' },
})

function TalliesStack(): React.JSX.Element {
	return (
		<Tallies.Navigator screenOptions={useStackOptions()}>
			<Tallies.Screen
				name="TallyList"
				component={TallyList}
				options={{ title: t('screens.tally-list.title'), headerLeft: HeaderLogo }}
			/>
			<Tallies.Screen
				name="TallyView"
				component={TallyView}
				options={{ title: t('screens.tally-view.title') }}
			/>
			<Tallies.Screen
				name="TallyHistory"
				component={TallyHistory}
				options={{ title: t('screens.tally-history.title') }}
			/>
			<Tallies.Screen
				name="CreateInvitation"
				component={CreateInvitation}
				options={{ title: t('screens.create-invitation.title') }}
			/>
			<Tallies.Screen
				name="ReviewOffer"
				component={ReviewOffer}
				options={{ title: t('screens.review-offer.title') }}
			/>
			<Tallies.Screen
				name="ReviewInvitation"
				component={ReviewInvitation}
				options={{ title: t('screens.review-invitation.title') }}
			/>
		</Tallies.Navigator>
	)
}

function AttentionRoot(): React.JSX.Element {
	return (
		<AttentionStack.Navigator screenOptions={useStackOptions()}>
			<AttentionStack.Screen
				name="Attention"
				component={Attention}
				options={{ title: t('tab.attention') }}
			/>
		</AttentionStack.Navigator>
	)
}

function PositionRoot(): React.JSX.Element {
	return (
		<PositionStack.Navigator screenOptions={useStackOptions()}>
			<PositionStack.Screen
				name="Position"
				component={Position}
				options={{ title: t('tab.position') }}
			/>
		</PositionStack.Navigator>
	)
}

export function AppNavigator(): React.JSX.Element {
	const tokens = useTokens()
	const session = useSession()
	const onboarded = isOnboarded(session.party)

	// Only before the first answer. A reload keeps the navigator mounted, so a
	// link that changed the variant is not lost while the party is re-read.
	if (session.initialising) {
		return <Loading />
	}

	// One container, always with `linking`. Two containers — one for onboarding
	// without linking — meant that during first run nothing consumed incoming
	// URLs at all, so every link after visiting first run was silently dead.
	if (!onboarded) {
		return (
			<NavigationContainer linking={linking} theme={navigationTheme(tokens)}>
				<OnboardingStack />
			</NavigationContainer>
		)
	}

	return (
		<NavigationContainer linking={linking} theme={navigationTheme(tokens)}>
			<Tabs.Navigator
				screenOptions={({ route }) => ({
					headerShown: false,
					tabBarActiveTintColor: tokens.accent,
					tabBarInactiveTintColor: tokens.textSecondary,
					tabBarStyle: { backgroundColor: tokens.surface, borderTopColor: tokens.border },
					tabBarLabelStyle: typography.small,
					// Icon and label together, never an icon alone (`global/ui.md`).
					tabBarIcon: ({ color, size, focused }) => {
						const tab = tabs.find(item => item.name === route.name)
						return (
							<Ionicons
								name={(focused ? tab?.iconActive : tab?.icon) as never}
								size={size}
								color={color}
							/>
						)
					},
				})}
			>
				{tabs.map(tab => (
					<Tabs.Screen
						key={tab.name}
						name={tab.name}
						component={componentFor[tab.name]}
						options={{ title: t(tab.labelKey) }}
					/>
				))}
			</Tabs.Navigator>
		</NavigationContainer>
	)
}

const componentFor: Record<keyof TabParams, React.ComponentType> = {
	Tallies: TalliesStack,
	AttentionTab: AttentionRoot,
	PositionTab: PositionRoot,
}

function useStackOptions() {
	const tokens = useTokens()
	return {
		headerStyle: { backgroundColor: tokens.background },
		headerTintColor: tokens.accent,
		headerTitleStyle: { color: tokens.textPrimary },
		contentStyle: { backgroundColor: tokens.background },
	}
}

/** The app's tokens, in the shape React Navigation wants for its own chrome. */
function navigationTheme(tokens: Tokens): Theme {
	return {
		dark: false,
		colors: {
			primary: tokens.accent,
			background: tokens.background,
			card: tokens.surface,
			text: tokens.textPrimary,
			border: tokens.border,
			notification: tokens.accent,
		},
		fonts: {
			regular: { fontFamily: 'System', fontWeight: '400' },
			medium: { fontFamily: 'System', fontWeight: '500' },
			bold: { fontFamily: 'System', fontWeight: '600' },
			heavy: { fontFamily: 'System', fontWeight: '700' },
		},
	}
}
