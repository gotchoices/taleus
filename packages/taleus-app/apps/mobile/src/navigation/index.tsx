import { useCallback, useEffect, useMemo, useState } from 'react'
import { BackHandler, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Attention } from '../screens/Attention'
import { Position } from '../screens/Position'
import { TallyHistory } from '../screens/TallyHistory'
import { TallyList } from '../screens/TallyList'
import { TallyView } from '../screens/TallyView'
import { setLocale, t } from '../i18n'
import { setVariant, variantFromUrl } from '../mock/variant'
import { useStyles, useTokens, spacing, touchTarget, type as typography, type Tokens } from '../theme'
import { isRoute, tabForRoute, tabs, type RouteName, type RouteParams, type TabName } from './routes'

/**
 * A small navigator: one stack per tab, plus deep links.
 *
 * React Navigation is what `global/toolchain.md` names, and this is not a
 * replacement for it — `react-native-screens` 4.27 does not build against
 * React Native 0.82 (its codegen rejects the `showColumn` command signature),
 * and only nightlies exist beyond it. Rather than take a nightly native
 * dependency at the fifth slice, this holds the same shape: screens receive
 * `{ route, navigation }`, route names match `navigation.md`, and swapping the
 * real library in later touches this file and the screens' prop type alias.
 * Tracked as `debt-mobile-navigation-library`.
 */
interface Frame {
	name: RouteName
	params?: RouteParams[RouteName]
}

const screens: Record<RouteName, React.ComponentType<any>> = {
	TallyList,
	TallyView,
	TallyHistory,
	Attention,
	Position,
}

const titleKeys: Record<RouteName, string> = {
	TallyList: 'screens.tally-list.title',
	TallyView: 'screens.tally-view.title',
	TallyHistory: 'screens.tally-history.title',
	Attention: 'tab.attention',
	Position: 'tab.position',
}

export function AppNavigator(): React.JSX.Element {
	const tokens = useTokens()
	const styles = useStyles(make)
	const [tab, setTab] = useState<TabName>('Tallies')
	const [stacks, setStacks] = useState<Record<TabName, Frame[]>>({
		Tallies: [{ name: 'TallyList' }],
		Attention: [{ name: 'Attention' }],
		Position: [{ name: 'Position' }],
	})

	const navigate = useCallback(<T extends RouteName>(name: T, params?: RouteParams[T]) => {
		const target = tabForRoute[name]
		setTab(target)
		setStacks(prev => {
			const stack = prev[target]
			const top = stack[stack.length - 1]
			// Following a link to the screen you are already on replaces it
			// (`navigation.md` § Behavior) — opening the same notification twice
			// must not build a pile of identical screens.
			if (top?.name === name) {
				return { ...prev, [target]: [...stack.slice(0, -1), { name, params }] }
			}
			const isRootOfTab = stack[0]?.name === name
			return {
				...prev,
				[target]: isRootOfTab ? [{ name, params }] : [...stack, { name, params }],
			}
		})
	}, [])

	/** True when there was somewhere to go back to. */
	const goBack = useCallback((): boolean => {
		let popped = false
		setStacks(prev => {
			if (prev[tab].length <= 1) {
				return prev
			}
			popped = true
			return { ...prev, [tab]: prev[tab].slice(0, -1) }
		})
		return popped
	}, [tab])

	const depth = stacks[tab].length

	// Android's hardware and gesture back go back within the app, and only leave
	// Taleus from a tab root (`navigation.md` § Behavior).
	useEffect(() => {
		const sub = BackHandler.addEventListener('hardwareBackPress', () => {
			if (depth > 1) {
				goBack()
				return true
			}
			if (tab !== 'Tallies') {
				setTab('Tallies')
				return true
			}
			return false
		})
		return () => sub.remove()
	}, [depth, goBack, tab])

	// Deep links: taleus://screen/<Route>[/<id>][?variant=&locale=]
	useEffect(() => {
		const open = (url: string | null) => {
			if (!url) {
				return
			}
			const variant = variantFromUrl(url)
			if (variant) {
				setVariant(variant)
			}
			const locale = /[?&]locale=([^&]+)/.exec(url)
			if (locale) {
				setLocale(decodeURIComponent(locale[1]))
			}
			const match = /screen\/([A-Za-z]+)(?:\/([^?]+))?/.exec(url)
			if (!match || !isRoute(match[1])) {
				return
			}
			navigate(match[1], match[2] ? ({ tallyId: decodeURIComponent(match[2]) } as never) : undefined)
		}

		void Linking.getInitialURL().then(open)
		const sub = Linking.addEventListener('url', event => open(event.url))
		return () => sub.remove()
	}, [navigate])

	const stack = stacks[tab]
	const current = stack[stack.length - 1]
	const Screen = screens[current.name]
	const navigation = useMemo(() => ({ navigate, goBack: () => void goBack() }), [navigate, goBack])

	return (
		<SafeAreaView style={styles.root} edges={['top', 'bottom']}>
			<View style={styles.header}>
				{depth > 1 ? (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={t('common.back')}
						onPress={() => void goBack()}
						style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}
					>
						<Text style={styles.back}>{'‹ '}{t('common.back')}</Text>
					</Pressable>
				) : null}
				<Text style={styles.title} numberOfLines={1}>
					{t(titleKeys[current.name])}
				</Text>
			</View>

			<View style={styles.body}>
				<Screen route={{ name: current.name, params: current.params }} navigation={navigation} />
			</View>

			<View style={styles.tabBar} accessibilityRole="tablist">
				{tabs.map(item => {
					const active = item.name === tab
					return (
						<Pressable
							key={item.name}
							accessibilityRole="tab"
							accessibilityState={{ selected: active }}
							android_ripple={{ color: tokens.border }}
							onPress={() => setTab(item.name)}
							style={({ pressed }) => [styles.tab, pressed ? styles.pressed : null]}
						>
							{/* Icon + label is what `ui.md` asks for; the icon set is a native
							    dependency this build does not have yet — `debt-mobile-icon-set`. */}
							<Text style={active ? styles.tabLabelActive : styles.tabLabel}>
								{t(item.labelKey)}
							</Text>
						</Pressable>
					)
				})}
			</View>
		</SafeAreaView>
	)
}

const make = (tokens: Tokens) => ({
	root: { flex: 1, backgroundColor: tokens.background },
	header: {
		flexDirection: 'row' as const,
		alignItems: 'center' as const,
		gap: spacing[2],
		paddingHorizontal: spacing[2],
		minHeight: touchTarget,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: tokens.border,
	},
	backButton: {
		minHeight: touchTarget,
		justifyContent: 'center' as const,
		paddingHorizontal: spacing[1],
	},
	pressed: { opacity: 0.6 },
	back: { ...typography.body, color: tokens.accent },
	title: { ...typography.title, color: tokens.textPrimary, flexShrink: 1 },
	body: { flex: 1 },
	tabBar: {
		flexDirection: 'row' as const,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: tokens.border,
		backgroundColor: tokens.surface,
	},
	tab: {
		flex: 1,
		alignItems: 'center' as const,
		justifyContent: 'center' as const,
		minHeight: touchTarget,
		paddingVertical: spacing[1],
	},
	tabLabel: { ...typography.caption, color: tokens.textSecondary },
	tabLabelActive: { ...typography.caption, color: tokens.accent, fontWeight: '600' as const },
})
