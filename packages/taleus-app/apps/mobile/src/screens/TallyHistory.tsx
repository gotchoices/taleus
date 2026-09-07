import { useCallback } from 'react'
import { FlatList, Text, View } from 'react-native'

import { Amount, Chip, Empty, Failed, Loading, directionOf } from '../components'
import { listEntries, type Entry } from '../data/entries'
import { listRequests, type PaymentRequest } from '../data/requests'
import { readTally, type TallyDetail } from '../data/tally'
import type { Result, Unit } from '../data/types'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'
import { formatAmount } from '../util/amount'
import { formatInstant } from '../util/date'

type Props = ScreenProps<'TallyHistory'>

interface HistoryPage {
	tally: TallyDetail
	entries: Entry[]
	requests: PaymentRequest[]
}

/**
 * TallyHistory (story 24) — what has actually happened, and what is still being
 * asked.
 *
 * Every entry carries the balance that resulted *stated from this party's
 * side*, so today's figure can be followed back rather than trusted; a bare
 * "Balance $180.00" would put the sign back on the reader, which is the one
 * thing this app does not do. Outstanding requests sit *alongside* the entries,
 * never in them, and each says which way it runs.
 */
export function TallyHistory({ route }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { tallyId } = route.params

	const load = useCallback(async (): Promise<Result<HistoryPage>> => {
		const detail = await readTally(tallyId)
		if (!detail.ok) {
			return detail
		}
		const [history, asked] = await Promise.all([listEntries(tallyId), listRequests(tallyId)])
		return {
			ok: true,
			value: {
				tally: detail.value,
				entries: history.ok ? history.value : [],
				requests: asked.ok ? asked.value.filter(r => r.state !== 'answered') : [],
			},
		}
	}, [tallyId])

	const { state, value, error, reload } = useLoad(load)

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.tally-history.unreadable-title')} error={error} onRetry={reload} />
	}

	const { tally, entries, requests } = value
	if (entries.length === 0 && requests.length === 0) {
		return (
			<Empty
				title={t('screens.tally-history.empty-title')}
				body={t('screens.tally-history.empty-body')}
			/>
		)
	}

	return (
		<FlatList
			style={styles.screen}
			data={entries}
			keyExtractor={entry => entry.id}
			ListHeaderComponent={
				requests.length > 0 ? <Asked requests={requests} unit={tally.unit} /> : null
			}
			renderItem={({ item }) => <EntryRow entry={item} unit={tally.unit} />}
		/>
	)
}

function Asked({ requests, unit }: { requests: PaymentRequest[]; unit: Unit }): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<View style={styles.asked}>
			<Text style={styles.askedTitle}>{t('screens.tally-history.still-asked')}</Text>
			{requests.map(request => (
				<View key={request.id} style={styles.askedRow}>
					<View style={styles.grow}>
						<Text style={styles.body}>
							{request.memo ?? t('screens.tally-history.request-generic')}
						</Text>
						<Text style={styles.meta}>
							{t(`screens.tally-history.request-${request.direction}`)}
							{' · '}
							{request.applied.units > 0
								? t('screens.tally-history.applied', {
										count: request.outstandingDays,
										applied: formatAmount(request.applied, unit),
										days: request.outstandingDays,
									})
								: t('screens.tally-history.outstanding-days', {
										count: request.outstandingDays,
										days: request.outstandingDays,
									})}
						</Text>
					</View>
					<Amount value={request.stillAsked} unit={unit} />
				</View>
			))}
			<Text style={styles.caption}>{t('screens.tally-history.asked-note')}</Text>
		</View>
	)
}

function EntryRow({ entry, unit }: { entry: Entry; unit: Unit }): React.JSX.Element {
	const styles = useStyles(make)
	const direction = directionOf(entry.amount)
	const after = entry.balanceAfter

	return (
		<View style={styles.entry}>
			<View style={styles.entryTop}>
				<Text style={styles.body}>{entry.memo ?? t('screens.tally-history.entry-generic')}</Text>
				<Amount value={entry.amount} unit={unit} perspective={direction} />
			</View>
			<View style={styles.entryMeta}>
				<Text style={styles.meta}>{formatInstant(entry.date)}</Text>
				<Text style={styles.meta}>
					{entry.kind === 'routed'
						? t('screens.tally-history.routed')
						: t(`screens.tally-history.by-${entry.issuer}`)}
				</Text>
				<Text style={styles.meta}>
					{after.perspective === 'level'
						? t('screens.tally-history.balance-level')
						: t(`screens.tally-history.balance-${after.perspective}`, {
								balance: formatAmount(after, unit),
							})}
				</Text>
			</View>
			{entry.answers?.length || entry.unsettled ? (
				<View style={styles.entryChips}>
					{entry.answers?.length ? <Chip label={t('screens.tally-history.answered')} /> : null}
					{entry.unsettled ? <Chip label={t('screens.tally-history.unsettled')} urgent /> : null}
				</View>
			) : null}
		</View>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	asked: {
		backgroundColor: tokens.surfaceAlt,
		padding: spacing[3],
		gap: spacing[1],
		borderBottomWidth: 0.5,
		borderBottomColor: tokens.border,
	},
	askedTitle: { ...typography.small, color: tokens.textSecondary },
	askedRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: spacing[2] },
	grow: { flexShrink: 1 },
	entry: {
		padding: spacing[3],
		borderBottomWidth: 0.5,
		borderBottomColor: tokens.border,
		gap: spacing[0],
	},
	entryTop: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: spacing[2] },
	entryMeta: { flexDirection: 'row' as const, gap: spacing[2], flexWrap: 'wrap' as const },
	entryChips: { flexDirection: 'row' as const, gap: spacing[1], marginTop: spacing[0] },
	body: { ...typography.body, color: tokens.textPrimary, flexShrink: 1 },
	caption: { ...typography.caption, color: tokens.textSecondary },
	meta: { ...typography.small, color: tokens.textSecondary },
})
