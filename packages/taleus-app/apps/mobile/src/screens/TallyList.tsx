import Ionicons from '@react-native-vector-icons/ionicons'
import { useCallback, useLayoutEffect } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'

import { Action, Amount, Chip, Empty, Failed, Loading, OpenableRow } from '../components'
import { listTallies } from '../data/tallies'
import type { TallySummary } from '../data/types'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, useTokens, spacing, type as typography, type Tokens } from '../theme'
import { formatInstant } from '../util/date'

type Props = ScreenProps<'TallyList'>

/**
 * TallyList (stories 06, 04) — the launch route once a party exists.
 *
 * Every tally the party holds, each readable without opening it: who it is
 * with, what it counts in, where the balance stands from this party's side,
 * when it last moved, and whether it is waiting on them.
 */
export function TallyList({ navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { state, value, error, reload } = useLoad(useCallback(() => listTallies(), []))
	const tokens = useTokens()

	useLayoutEffect(() => {
		navigation.setOptions({
			headerRight: () => <AddTally color={tokens.accent} onPress={() => navigation.navigate('CreateInvitation')} />,
		})
	}, [navigation, tokens.accent])

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed') {
		return <Failed title={t('screens.tally-list.error-title')} error={error} onRetry={reload} />
	}

	const tallies = value ?? []
	if (tallies.length === 0) {
		return (
			<Empty
				title={t('screens.tally-list.empty-title')}
				body={t('screens.tally-list.empty-body')}
			>
				<Action
					label={t('screens.tally-list.invite')}
					onPress={() => navigation.navigate('CreateInvitation')}
				/>
				<Action label={t('screens.tally-list.empty-accept')} onPress={() => navigation.navigate('Scan')} secondary />
			</Empty>
		)
	}

	return (
		<View style={styles.screen}>
			<FlatList
				data={tallies}
				keyExtractor={item => item.id}
				renderItem={({ item }) => (
					<TallyRow
						tally={item}
						onOpen={() => navigation.navigate('TallyView', { tallyId: item.id })}
					/>
				)}
			/>
		</View>
	)
}

/** Start another tally: in the header, so it is in reach however long the list is. */
function AddTally({ color, onPress }: { color: string; onPress: () => void }): React.JSX.Element {
	return (
		<Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t('screens.tally-list.invite')} hitSlop={8}>
			<Ionicons name="add" size={32} color={color} />
		</Pressable>
	)
}

function TallyRow({ tally, onOpen }: { tally: TallySummary; onOpen: () => void }): React.JSX.Element {
	const styles = useStyles(make)
	// An offer has no balance and is not "settled" — story 06 path C wants it
	// findable and not mistaken for an open tally, so the state leads and the
	// figure is suppressed until there is a tally to have one.
	const traded = tally.state !== 'Offered' && tally.state !== 'Forming' && tally.state !== 'Expired'
	// An invitation nobody has taken up has no counterparty yet: the party's own note names it.
	const name = tally.invitation
		? tally.invitation.note || t('screens.tally-list.invitation-unnamed')
		: tally.counterparty.name

	return (
		<OpenableRow
			onPress={onOpen}
			accessibilityLabel={t('screens.tally-list.a11y-open', { name })}
		>
			<View style={styles.rowMain}>
				<Text style={styles.rowName} numberOfLines={1}>
					{name}
				</Text>
				{traded ? (
					<Amount value={tally.balance} unit={tally.unit} perspective={tally.balance.perspective} />
				) : null}
			</View>
			<View style={styles.rowMeta}>
				{tally.waitingOn === 'me' ? <Chip label={t('screens.tally-list.waiting-on-me')} urgent /> : null}
				{tally.state !== 'Open' ? (
					<Chip label={tally.invitation ? t('screens.tally-list.state-invited') : t(`screens.tally-list.state-${tally.state.toLowerCase()}`)} />
				) : null}
				<Text style={styles.rowSubtle}>
					{traded
						? t(`screens.tally-list.${tally.balance.perspective}`)
						: t('screens.tally-list.no-balance-yet')}
				</Text>
				<Text style={styles.rowSubtle}>
					{t('screens.tally-list.last-activity', { date: formatInstant(tally.lastActivity) })}
				</Text>
			</View>
		</OpenableRow>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	rowMain: {
		flexDirection: 'row' as const,
		justifyContent: 'space-between' as const,
		// Not 'baseline': `Amount` is a View (the fraction is stacked), and Yoga
		// gives a baseline row containing a non-text child zero height.
		alignItems: 'center' as const,
		gap: spacing[2],
	},
	rowName: { ...typography.body, color: tokens.textPrimary, flexShrink: 1 },
	rowMeta: {
		flexDirection: 'row' as const,
		alignItems: 'center' as const,
		flexWrap: 'wrap' as const,
		gap: spacing[1],
		marginTop: spacing[0],
	},
	rowSubtle: { ...typography.small, color: tokens.textSecondary },
})
