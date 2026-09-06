import { useCallback, useEffect, useMemo, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Attention } from '../screens/Attention'
import { Position } from '../screens/Position'
import { TallyHistory } from '../screens/TallyHistory'
import { TallyList } from '../screens/TallyList'
import { TallyView } from '../screens/TallyView'
import { t } from '../i18n'
import { setVariant, variantFromUrl } from '../mock/variant'
import { dark, light, spacing, type as typography, type Tokens } from '../theme/tokens'
import { tabForRoute, tabs, type RouteName, type RouteParams, type TabName } from './routes'

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
 */
interface Entry {
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

const titleKeys: Partial<Record<RouteName, string>> = {
	TallyList: 'tally-list.title',
	TallyView: 'tally-view.title',
	TallyHistory: 'tally-history.title',
	Attention: 'tab.attention',
	Position: 'tab.position',
}

export function AppNavigator(): React.JSX.Element {
	const tokens = useColorScheme() === 'dark' ? dark : light
	const styles = makeStyles(tokens)
	const [tab, setTab] = useState<TabName>('Tallies')
	const [stacks, setStacks] = useState<Record<TabName, Entry[]>>({
		Tallies: [{ name: 'TallyList' }],
		Attention: [{ name: 'Attention' }],
		Position: [{ name: 'Position' }],
	})

	const navigate = useCallback(
		<T extends RouteName>(name: T, params?: RouteParams[T]) => {
			const target = tabForRoute[name]
			setTab(target)
			setStacks(prev => {
				const stack = prev[target]
				const isRoot = stack.length > 0 && stack[0].name === name
				return {
					...prev,
					[target]: isRoot ? [{ name, params }] : [...stack, { name, params }],
				}
			})
		},
		[],
	)

	const goBack = useCallback(() => {
		setStacks(prev => ({
			...prev,
			[tab]: prev[tab].length > 1 ? prev[tab].slice(0, -1) : prev[tab],
		}))
	}, [tab])

	// Deep links: taleus://screen/<Route>[/<id>][?variant=...]
	useEffect(() => {
		const open = (url: string | null) => {
			if (!url) {
				return
			}
			const variant = variantFromUrl(url)
			if (variant) {
				setVariant(variant)
			}
			const match = /screen\/([A-Za-z]+)(?:\/([^?]+))?/.exec(url)
			if (!match) {
				return
			}
			const name = match[1] as RouteName
			if (!(name in screens)) {
				return
			}
			navigate(name, match[2] ? ({ tallyId: decodeURIComponent(match[2]) } as never) : undefined)
		}

		void Linking.getInitialURL().then(open)
		const sub = Linking.addEventListener('url', event => open(event.url))
		return () => sub.remove()
	}, [navigate])

	const stack = stacks[tab]
	const current = stack[stack.length - 1]
	const Screen = screens[current.name]
	const navigation = useMemo(() => ({ navigate, goBack }), [navigate, goBack])

	return (
		<SafeAreaView style={styles.root} edges={['top', 'bottom']}>
			<View style={styles.header}>
				{stack.length > 1 ? (
					<Pressable onPress={goBack} hitSlop={spacing[2]}>
						<Text style={styles.back}>{t('common.back')}</Text>
					</Pressable>
				) : null}
				<Text style={styles.title}>
					{current.name === 'TallyView' && (current.params as RouteParams['TallyView'])?.counterpartyName
						? (current.params as RouteParams['TallyView']).counterpartyName
						: t(titleKeys[current.name] ?? 'app.name')}
				</Text>
			</View>

			<View style={styles.body}>
				<Screen route={{ name: current.name, params: current.params }} navigation={navigation} />
			</View>

			<View style={styles.tabBar}>
				{tabs.map(item => (
					<Pressable key={item.name} style={styles.tab} onPress={() => setTab(item.name)}>
						<Text style={item.name === tab ? styles.tabLabelActive : styles.tabLabel}>
							{t(item.labelKey)}
						</Text>
					</Pressable>
				))}
			</View>
		</SafeAreaView>
	)
}

function makeStyles(tokens: Tokens) {
	return StyleSheet.create({
		root: { flex: 1, backgroundColor: tokens.background },
		header: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing[2],
			paddingHorizontal: spacing[3],
			paddingVertical: spacing[2],
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: tokens.border,
		},
		back: { ...typography.body, color: tokens.accent },
		title: { ...typography.title, color: tokens.textPrimary },
		body: { flex: 1 },
		tabBar: {
			flexDirection: 'row',
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: tokens.border,
			backgroundColor: tokens.surface,
		},
		tab: { flex: 1, alignItems: 'center', paddingVertical: spacing[2] },
		tabLabel: { ...typography.small, color: tokens.textSecondary },
		tabLabelActive: { ...typography.small, color: tokens.accent },
	})
}
