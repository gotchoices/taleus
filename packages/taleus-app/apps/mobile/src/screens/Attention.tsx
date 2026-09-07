import { useCallback } from 'react'
import { FlatList, Text, View } from 'react-native'

import { Amount, Chip, Empty, Failed, Loading, OpenableRow } from '../components'
import { listAttention, type AttentionItem } from '../data/attention'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import { isTallyRoute, type ScreenProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'

type Props = ScreenProps<'Attention'>

/**
 * Attention (story 23) — everything waiting on this party, across every tally.
 *
 * Nothing here is prose carried in the data: an engine will never hand the app
 * English, so what an item *says* is written from its `kind` through `t()`.
 * Two absences are deliberate. Automated settling never appears: it was
 * authorized in advance and needs nothing. And items waiting on the *other*
 * party appear plainly marked, so a party knows about them without being asked
 * for anything.
 */
export function Attention({ navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { state, value, error, reload } = useLoad(useCallback(() => listAttention(), []))

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed') {
		return <Failed title={t('screens.attention.unreadable-title')} error={error} onRetry={reload} />
	}

	const items = value ?? []
	const mine = items.filter(item => item.waitingOn !== 'them')
	const theirs = items.filter(item => item.waitingOn === 'them')

	if (items.length === 0) {
		return (
			<Empty title={t('screens.attention.empty-title')} body={t('screens.attention.empty-body')} />
		)
	}

	const open = (item: AttentionItem) => {
		// Story 23 step 4: the point of the list is getting to the thing. The
		// routes attention items name — ReviewOffer, RequestView — are not sliced
		// yet, so they fall back to the tally the item belongs to rather than
		// navigating into nothing.
		navigation.navigate('Tallies', {
			screen: isTallyRoute(item.route) ? item.route : 'TallyView',
			params: { tallyId: item.tallyId },
		})
	}

	return (
		<FlatList
			style={styles.screen}
			data={mine}
			keyExtractor={item => item.id}
			ListHeaderComponent={
				mine.length === 0 ? (
					<Text style={styles.sectionNote}>{t('screens.attention.none-for-you')}</Text>
				) : undefined
			}
			renderItem={({ item }) => <Item item={item} needsYou onOpen={() => open(item)} />}
			ListFooterComponent={
				theirs.length > 0 ? (
					<View style={styles.footer}>
						<Text style={styles.sectionNote}>{t('screens.attention.waiting-on-others')}</Text>
						{theirs.map(item => (
							<Item key={item.id} item={item} onOpen={() => open(item)} />
						))}
					</View>
				) : undefined
			}
		/>
	)
}

function Item({
	item,
	needsYou,
	onOpen,
}: {
	item: AttentionItem
	needsYou?: boolean
	onOpen: () => void
}): React.JSX.Element {
	const styles = useStyles(make)
	const summary = t(`screens.attention.summary-${item.kind}`, { name: item.counterparty.name })

	return (
		<OpenableRow onPress={onOpen} accessibilityLabel={summary}>
			<View style={styles.itemTop}>
				<Text style={styles.body}>{summary}</Text>
				{item.amount ? (
					<Amount
						value={item.amount}
						unit={{ denom: item.amount.denom, scale: item.amount.scale }}
					/>
				) : null}
			</View>
			<View style={styles.itemMeta}>
				<Chip
					label={
						needsYou
							? t('screens.attention.needs-you')
							: t('screens.attention.waiting-on-them')
					}
					urgent={needsYou}
				/>
				<Text style={styles.meta}>
					{t('screens.attention.waiting-days', { count: item.waitingDays, days: item.waitingDays })}
				</Text>
			</View>
		</OpenableRow>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	itemTop: {
		flexDirection: 'row' as const,
		justifyContent: 'space-between' as const,
		alignItems: 'baseline' as const,
		gap: spacing[2],
	},
	itemMeta: {
		flexDirection: 'row' as const,
		alignItems: 'center' as const,
		gap: spacing[1],
		marginTop: spacing[0],
	},
	body: { ...typography.body, color: tokens.textPrimary, flexShrink: 1 },
	meta: { ...typography.small, color: tokens.textSecondary },
	sectionNote: { ...typography.caption, color: tokens.textSecondary, padding: spacing[3] },
	footer: { paddingTop: spacing[2] },
})
