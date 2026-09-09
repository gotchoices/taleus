import { useCallback } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { Action, Amount, Card, Chip, Failed, Loading, Row, directionOf } from '../components'
import { readEntry, type Entry } from '../data/entries'
import { listRequests, type PaymentRequest } from '../data/requests'
import { readTally, type TallyDetail } from '../data/tally'
import type { Result } from '../data/types'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'
import { formatInstantTime } from '../util/date'

type Props = ScreenProps<'EntryDetail'>

interface EntryPage {
	tally: TallyDetail
	entry: Entry
	/** The requests this entry answered, where it answered any. */
	answered: PaymentRequest[]
}

/**
 * EntryDetail (story 24 path C) — one entry, and everything the record holds
 * about it.
 *
 * The screen exists for the entry a party does not recognise. So it answers, in
 * order, every question they would ask: how much, which way, when, what was
 * written down, who signed it, what it answered, and whether it was deliberate
 * or routed through. Nothing in the history is anonymous, and this is where that
 * is made good.
 */
export function EntryDetail({ route, navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { tallyId, entryId } = route.params

	const load = useCallback(async (): Promise<Result<EntryPage>> => {
		const detail = await readTally(tallyId)
		if (!detail.ok) {
			return detail
		}
		const found = await readEntry(tallyId, entryId)
		if (!found.ok) {
			return found
		}
		const asked = await listRequests(tallyId)
		const answered = asked.ok
			? asked.value.filter(request => found.value.answers?.includes(request.id))
			: []
		return { ok: true, value: { tally: detail.value, entry: found.value, answered } }
	}, [tallyId, entryId])

	const { state, value, error, reload } = useLoad(load)

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.entry-detail.unreadable-title')} error={error} onRetry={reload} />
	}

	const { tally, entry, answered } = value
	const name = tally.counterparty.name
	const direction = directionOf(entry.amount)
	const toward = entry.amount.units > 0

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<View style={styles.figure}>
				<Amount value={entry.amount} unit={tally.unit} perspective={direction} size="display" />
				<Text style={styles.caption}>
					{/* Routed value is said differently because nobody handed it over:
					    it moved because a payment found its way through (step 5). */}
					{entry.kind === 'routed'
						? t(toward ? 'screens.entry-detail.routed-in' : 'screens.entry-detail.routed-out')
						: t(toward ? 'screens.entry-detail.gave-me' : 'screens.entry-detail.gave-them', { name })}
				</Text>
				{entry.unsettled ? <Chip label={t('screens.entry-detail.unsettled')} urgent /> : null}
			</View>

			{entry.unsettled ? (
				<Card>
					<Text style={styles.caption}>{t('screens.entry-detail.unsettled-note')}</Text>
				</Card>
			) : null}

			<Card>
				<Row
					label={t('screens.entry-detail.what-for')}
					value={entry.memo ?? t('screens.entry-detail.no-memo')}
				/>
				<Row
					label={t('screens.entry-detail.when')}
					// `formatInstantTime` already carries the date; the two together read
					// as the same day printed twice.
					value={formatInstantTime(entry.date)}
				/>
				<Row
					label={t('screens.entry-detail.balance-after')}
					value={
						entry.balanceAfter.perspective === 'level' ? (
							t('screens.tally-history.balance-level')
						) : (
							<Amount
								value={entry.balanceAfter}
								unit={tally.unit}
								perspective={entry.balanceAfter.perspective}
							/>
						)
					}
				/>
			</Card>

			{/* Step 3: the one who gave the value signed it, so there is never a
			    question of who said what. */}
			<Card title={t('screens.entry-detail.who-signed')}>
				<Text style={styles.body}>
					{entry.kind === 'routed'
						? t('screens.entry-detail.signed-network')
						: entry.issuer === 'me'
							? t('screens.entry-detail.signed-me')
							: t('screens.entry-detail.signed-them', { name })}
				</Text>
			</Card>

			{answered.length > 0 ? (
				<Card
					title={t('screens.entry-detail.answered')}
					footnote={t('screens.entry-detail.answered-note')}
				>
					{answered.map(request => (
						<View key={request.id} style={styles.block}>
							<Row
								label={request.memo ?? t('screens.tally-history.request-generic')}
								value={<Amount value={request.amount} unit={tally.unit} />}
							/>
							<Action
								label={t('screens.entry-detail.open-request')}
								onPress={() => navigation.navigate('RequestView', { requestId: request.id })}
								secondary
							/>
						</View>
					))}
				</Card>
			) : null}

			<Text style={styles.caption}>{t('screens.entry-detail.unrecognised')}</Text>
		</ScrollView>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	figure: { alignItems: 'center' as const, paddingVertical: spacing[3], gap: spacing[1] },
	block: { gap: spacing[1] },
	body: { ...typography.body, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary, textAlign: 'center' as const },
})
