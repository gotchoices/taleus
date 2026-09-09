import { useCallback, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'

import { Action, Amount, Card, Chip, Failed, Loading, Row } from '../components'
import { declineRequest, readRequest, withdrawRequest, type PaymentRequest } from '../data/requests'
import { readTally } from '../data/tally'
import type { Result, Unit } from '../data/types'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, useTokens, spacing, touchTarget, type as typography, type Tokens } from '../theme'

type Props = ScreenProps<'RequestView'>

interface Page {
	request: PaymentRequest
	unit: Unit
	counterparty: string
}

/**
 * RequestView (stories 21, 22) — one request, from whichever side of it.
 *
 * **The amount is theirs.** Story 22 step 3: the payer answers a request rather
 * than deciding a figure, so paying hands the requester's amount to
 * `PayPartner` rather than opening an empty field. Paying part is offered as its
 * own act, because a request may be answered in full, in part, or not at all —
 * and the payer says which.
 *
 * **It does not lapse.** There is no expiry anywhere on this screen; what it
 * shows instead is how long it has been waiting. Time alone decides nothing.
 */
export function RequestView({ route, navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const tokens = useTokens()
	const { requestId } = route.params

	const load = useCallback(async (): Promise<Result<Page>> => {
		const request = await readRequest(requestId)
		if (!request.ok) {
			return request
		}
		const tally = await readTally(request.value.tallyId)
		return {
			ok: true,
			value: {
				request: request.value,
				unit: tally.ok ? tally.value.unit : { denom: 'iso4217:USD', scale: 2 },
				counterparty: tally.ok
					? tally.value.counterparty.name
					: (request.value.requester?.name ?? ''),
			},
		}
	}, [requestId])

	const { state, value, error, reload } = useLoad(load)
	const [why, setWhy] = useState('')

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.request-view.unreadable-title')} error={error} onRetry={reload} />
	}

	const { request, unit, counterparty } = value
	const mine = request.direction === 'asked-by-me'
	const settled = ['refused', 'withdrawn', 'answered'].includes(request.state)
	const part = request.state === 'part-answered'

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Text style={styles.lead}>
				{t(`screens.request-view.${request.direction}`, { name: counterparty })}
			</Text>
			<Amount value={request.stillAsked} unit={unit} size="display" />

			<Card>
				<Row label={t('screens.request-view.for')} value={request.memo ?? '—'} />
				<Row
					label={t('screens.request-view.waiting', { days: request.outstandingDays })}
					value={<Chip label={t(`screens.tally-history.request-${request.direction}`)} />}
				/>
				{part || request.applied.units > 0 ? (
					<>
						<Row
							label={t('screens.request-view.applied')}
							value={<Amount value={request.applied} unit={unit} />}
						/>
						<Row
							label={t('screens.request-view.still-asked')}
							value={<Amount value={request.stillAsked} unit={unit} />}
						/>
						<Text style={styles.caption}>{t('screens.request-view.part-note')}</Text>
					</>
				) : null}
				<Text style={styles.caption}>{t('screens.request-view.no-clock')}</Text>
			</Card>

			{settled ? (
				<Card>
					<Text style={styles.body}>
						{t(`screens.request-view.state-${request.state}`, {
							still: `${request.stillAsked.units / 10 ** unit.scale}`,
						})}
					</Text>
				</Card>
			) : mine ? (
				<Card footnote={t('screens.request-view.withdraw-note')}>
					<Action
						label={t('screens.request-view.withdraw')}
						onPress={() => void withdrawRequest(requestId).then(reload)}
						secondary
					/>
				</Card>
			) : (
				<>
					<Card footnote={t('screens.request-view.pay-note')}>
						<Text style={styles.caption}>{t('screens.request-view.not-a-commitment')}</Text>
						<Action
							label={t('screens.request-view.pay-full')}
							onPress={() =>
								navigation.navigate('PayPartner', {
									tallyId: request.tallyId,
									amount: request.stillAsked.units / 10 ** unit.scale,
									answers: request.id,
								})
							}
						/>
						<Action
							label={t('screens.request-view.pay-part')}
							onPress={() =>
								navigation.navigate('PayPartner', {
									tallyId: request.tallyId,
									answers: request.id,
								})
							}
							secondary
						/>
					</Card>

					<Card footnote={t('screens.request-view.decline-note')}>
						<TextInput
							accessibilityLabel={t('screens.request-view.decline-why')}
							value={why}
							onChangeText={setWhy}
							placeholder={t('screens.request-view.decline-why')}
							placeholderTextColor={tokens.textSecondary}
							style={styles.input}
						/>
						<Action
							label={t('screens.request-view.decline')}
							onPress={() => void declineRequest(requestId, why.trim() || undefined).then(reload)}
							secondary
						/>
					</Card>
				</>
			)}

			{/* Path E: enough to tell a forgotten obligation from a mistake. */}
			<Card title={t('screens.request-view.who-title')}>
				<Text style={styles.body}>{t('screens.request-view.on-tally', { name: counterparty })}</Text>
				<Action
					label={t('screens.request-view.see-history')}
					onPress={() => navigation.navigate('TallyHistory', { tallyId: request.tallyId })}
					secondary
				/>
			</Card>
		</ScrollView>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	lead: { ...typography.body, color: tokens.textSecondary },
	body: { ...typography.body, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary },
	input: {
		...typography.body,
		color: tokens.textPrimary,
		backgroundColor: tokens.surface,
		borderRadius: spacing[1],
		borderWidth: 1,
		borderColor: tokens.border,
		minHeight: touchTarget,
		paddingHorizontal: spacing[2],
	},
})
