import { useCallback, useState } from 'react'
import { FlatList, Text, View } from 'react-native'

import { Action, Amount, Chip, Empty, Failed, Loading, OpenableRow } from '../components'
import { listAttention, setAside, soonWithinDays, type AttentionItem } from '../data/attention'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import { unitOf } from '../data/types'
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
 *
 * Setting something aside is the third: it stops asking without answering, and
 * the list becomes what the party means to deal with rather than everything
 * outstanding. The wording is careful — nothing reaches the counterparty — because
 * the one thing this must never be mistaken for is a refusal.
 */
export function Attention({ navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { state, value, error, reload } = useLoad(useCallback(() => listAttention(), []))
	// Path C: after a week away, knowing what has already been dealt with this
	// session is what lets a party work through eleven things without losing
	// their place.
	const [handled, setHandled] = useState(0)

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
			<Empty title={t('screens.attention.empty-title')} body={t('screens.attention.empty-body')}>
				<Text style={styles.sectionNote}>{t('screens.attention.empty-history')}</Text>
				<Action
					label={t('screens.attention.see-history')}
					onPress={() => navigation.navigate('AttentionHistory')}
					secondary
				/>
			</Empty>
		)
	}

	const aside = async (item: AttentionItem) => {
		await setAside(item.id)
		setHandled(count => count + 1)
		reload()
	}

	const open = (item: AttentionItem) => {
		// Story 23 step 4: the point of the list is getting to the thing. The
		// routes attention items name — ReviewOffer, RequestView — are not sliced
		// yet, so they fall back to the tally the item belongs to rather than
		// navigating into nothing.
		// An attention item names a route from `navigation.md`. Those that are about
		// a tally take its id; `RequestView` needs a request id, which an item does
		// not carry — so it lands on the tally, where the request is listed.
		// A request item now knows its own request, so it lands on the request
		// rather than on the tally it happens to sit under.
		if (item.route === 'RequestView' && item.requestId) {
			navigation.navigate('Tallies', {
				screen: 'RequestView',
				params: { requestId: item.requestId },
			})
			return
		}
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
				<View>
					{handled > 0 ? (
						<Text style={styles.sectionNote}>
							{t('screens.attention.handled', { count: handled })}
						</Text>
					) : null}
					{mine.length === 0 ? (
						<Text style={styles.sectionNote}>{t('screens.attention.none-for-you')}</Text>
					) : null}
				</View>
			}
			renderItem={({ item }) => (
				<Item item={item} needsYou onOpen={() => open(item)} onAside={() => void aside(item)} />
			)}
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
			ListFooterComponentStyle={styles.footerStyle}
		/>
	)
}

function Item({
	item,
	needsYou,
	onOpen,
	onAside,
}: {
	item: AttentionItem
	needsYou?: boolean
	onOpen: () => void
	onAside?: () => void
}): React.JSX.Element {
	const styles = useStyles(make)
	const summary = t(`screens.attention.summary-${item.kind}`, { name: item.counterparty.name })

	return (
		<View>
		<OpenableRow onPress={onOpen} accessibilityLabel={summary}>
			<View style={styles.itemTop}>
				<Text style={styles.body}>{summary}</Text>
				{item.amount ? <Amount value={item.amount} unit={unitOf(item.amount)} /> : null}
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
				{/* Path B: urgent and merely open must be tellable apart without the
				    party reading dates and doing the arithmetic themselves. */}
				<Deadline item={item} />
			</View>
		</OpenableRow>
		{onAside ? (
			<View style={styles.asideRow}>
				<Action label={t('screens.attention.set-aside')} onPress={onAside} secondary />
			</View>
		) : null}
		</View>
	)
}

function Deadline({ item }: { item: AttentionItem }): React.JSX.Element {
	const styles = useStyles(make)
	if (item.daysLeft === undefined) {
		return <Text style={styles.meta}>{t('screens.attention.open-ended')}</Text>
	}
	const soon = item.daysLeft <= soonWithinDays
	if (item.daysLeft === 0) {
		return <Text style={styles.urgent}>{t('screens.attention.runs-out-today')}</Text>
	}
	return (
		<Text style={soon ? styles.urgent : styles.meta}>
			{t('screens.attention.runs-out', { count: item.daysLeft, days: item.daysLeft })}
		</Text>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	itemTop: {
		flexDirection: 'row' as const,
		justifyContent: 'space-between' as const,
		alignItems: 'center' as const,
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
	urgent: { ...typography.small, color: tokens.negative },
	asideRow: {
		flexDirection: 'row' as const,
		justifyContent: 'flex-end' as const,
		paddingHorizontal: spacing[2],
	},
	footerStyle: { paddingBottom: spacing[3] },
	sectionNote: { ...typography.caption, color: tokens.textSecondary, padding: spacing[3] },
	footer: { paddingTop: spacing[2] },
})
