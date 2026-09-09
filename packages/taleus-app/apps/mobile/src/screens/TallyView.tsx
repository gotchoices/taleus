import { useCallback } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { Action, Amount, Card, Chip, Failed, Loading, Row } from '../components'
import { listRequests, type PaymentRequest } from '../data/requests'
import { readTally, type TallyDetail } from '../data/tally'
import type { Result } from '../data/types'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'
import { formatCivilDate, formatInstant } from '../util/date'

type Props = ScreenProps<'TallyView'>

interface TallyPage {
	tally: TallyDetail
	requests: PaymentRequest[]
}

/**
 * TallyView (stories 04, 07) — what a tally is, from this party's side.
 *
 * Terms are shown in both directions and labelled by who extended them, each
 * with its own effective date, because the two sides took effect on different
 * days. Room to spend is kept visibly separate from value held. And an
 * unreachable counterparty does not make the tally unreadable: it is this
 * party's record too (story 04 path C).
 */
export function TallyView({ route, navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { tallyId } = route.params

	const load = useCallback(async (): Promise<Result<TallyPage>> => {
		const detail = await readTally(tallyId)
		if (!detail.ok) {
			return detail
		}
		const asked = await listRequests(tallyId)
		return { ok: true, value: { tally: detail.value, requests: asked.ok ? asked.value : [] } }
	}, [tallyId])

	const { state, value, error, reload } = useLoad(load)

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.tally-view.unreadable-title')} error={error} onRetry={reload} />
	}

	const { tally, requests } = value
	const open = requests.filter(request => request.state !== 'answered' && request.state !== 'withdrawn')

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<View style={styles.balanceBlock}>
				<Amount
					value={tally.balance}
					unit={tally.unit}
					perspective={tally.balance.perspective}
					size="display"
				/>
				<Text style={styles.balanceLabel}>
					{t(`screens.tally-view.${tally.balance.perspective}`, { name: tally.counterparty.name })}
				</Text>
				{tally.balance.perspective === 'level' ? (
					<Text style={styles.centredCaption}>{t('screens.tally-view.settled-note')}</Text>
				) : null}
			</View>

			{tally.state !== 'Open' ? (
				<View style={styles.chipRow}>
					<Chip label={t(`screens.tally-view.state-${tally.state.toLowerCase()}`)} urgent={tally.waitingOn === 'me'} />
				</View>
			) : null}

			{!tally.counterpartyReachable ? (
				<Card title={t('screens.tally-view.unreachable-title')}>
					<Text style={styles.caption}>{t('screens.tally-view.unreachable-body')}</Text>
					{(tally.pending ?? []).map(item => (
						<Row
							key={`${item.kind}-${item.since}`}
							label={t(`screens.tally-view.pending-${item.kind}`)}
							note={t('screens.tally-view.pending-since', { date: formatInstant(item.since) })}
						/>
					))}
				</Card>
			) : null}

			<Card title={t('screens.tally-view.terms-title')}>
				<Row
					label={t('screens.tally-view.i-extend')}
					note={`${t('screens.tally-view.notice-days', { count: tally.terms.mine.noticeDays, days: tally.terms.mine.noticeDays })} · ${t('screens.tally-view.effective-since', { date: formatCivilDate(tally.terms.mine.effective) })}`}
					value={<Amount value={tally.terms.mine.creditLimit} unit={tally.unit} />}
				/>
				<Row
					label={t('screens.tally-view.they-extend', { name: tally.counterparty.name })}
					note={`${t('screens.tally-view.notice-days', { count: tally.terms.theirs.noticeDays, days: tally.terms.theirs.noticeDays })} · ${t('screens.tally-view.effective-since', { date: formatCivilDate(tally.terms.theirs.effective) })}`}
					value={<Amount value={tally.terms.theirs.creditLimit} unit={tally.unit} />}
				/>
				<Row
					label={t('screens.tally-view.room-to-spend')}
					note={t('screens.tally-view.room-note')}
					value={<Amount value={tally.roomToSpend} unit={tally.unit} />}
				/>
			</Card>

			<Card title={t('screens.tally-view.agreement-title')}>
				<Text style={styles.body}>{tally.agreement.title}</Text>
				<Text style={styles.meta}>
					{t('screens.tally-view.agreement-meta', {
						publisher: tally.agreement.publisher,
						language: tally.agreement.language,
					})}
				</Text>
			</Card>

			<Card
				title={t('screens.tally-view.who-title')}
				footnote={t('screens.tally-view.disclosure-note')}
			>
				{Object.entries(tally.counterparty.disclosed ?? {}).map(([field, disclosed]) => (
					<Row key={field} label={t(`disclosure.${field}`)} value={disclosed} />
				))}
			</Card>

			{open.length > 0 ? (
				<Card
					title={t('screens.tally-view.requests-title')}
					footnote={t('screens.tally-view.requests-note')}
				>
					{open.map(request => (
						<Row
							key={request.id}
							label={request.memo ?? t('screens.tally-view.request-generic')}
							note={`${t(`screens.tally-view.request-${request.direction}`)} · ${t('screens.tally-view.request-outstanding', { count: request.outstandingDays, days: request.outstandingDays })}`}
							value={<Amount value={request.stillAsked} unit={tally.unit} />}
						/>
					))}
				</Card>
			) : null}

			{/*
			 * Story 04 step 7: what to do next. These were deliberately absent while
			 * Pay and Request were unsliced — a button routing nowhere is worse than
			 * no button. Changing one's own limit is still unsliced, so it is still
			 * absent.
			 */}
			<Action
				label={t('screens.tally-view.pay')}
				onPress={() => navigation.navigate('PayPartner', { tallyId: tally.id })}
			/>
			<Action
				label={t('screens.tally-view.ask')}
				onPress={() => navigation.navigate('CreateRequest', { tallyId: tally.id })}
				secondary
			/>
			<Action
				label={t('screens.tally-view.see-history')}
				onPress={() => navigation.navigate('TallyHistory', { tallyId: tally.id })}
				secondary
			/>
		</ScrollView>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	balanceBlock: { alignItems: 'center' as const, paddingVertical: spacing[3], gap: spacing[0] },
	balanceLabel: { ...typography.body, color: tokens.textSecondary },
	chipRow: { flexDirection: 'row' as const },
	body: { ...typography.body, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary },
	centredCaption: {
		...typography.caption,
		color: tokens.textSecondary,
		textAlign: 'center' as const,
	},
	meta: { ...typography.small, color: tokens.textSecondary },
})
