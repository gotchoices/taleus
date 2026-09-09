import { useCallback, useState } from 'react'
import { ScrollView, Text } from 'react-native'

import { Action, Amount, Card, Failed, Loading, Row, amountText } from '../components'
import { readTally, requestClose, withdrawClose, type TallyDetail } from '../data/tally'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import { divisorOf } from '../util/amount'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'
import { formatCivilDate, formatInstant } from '../util/date'

type Props = ScreenProps<'CloseTally'>

/**
 * CloseTally (story 05) — winding a tally down.
 *
 * **Consequences before the act** (step 2). Closing is the one thing a party can
 * always do and the other cannot refuse, so the screen states what it costs
 * before asking for it: nothing more builds up, what is owed does not go away,
 * and the tally ends at zero.
 *
 * **A closing tally is waiting, not broken** (path C). It can stay this way for
 * a year. The screen says so rather than presenting it as stuck or finished.
 *
 * **Nothing is written off automatically.** A remainder is forgiven by a
 * deliberate act with an author — and only by the party it belongs to. Whether a
 * remainder is trivial enough to offer that for is the engine's judgement
 * (`closing.offerWriteOff`), not a threshold this app invents: what counts as
 * not worth chasing depends on the unit and on what the parties trade in.
 */
export function CloseTally({ route, navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { tallyId } = route.params
	const { state, value, error, reload } = useLoad(useCallback(() => readTally(tallyId), [tallyId]))
	const [writeOffDeclined, setWriteOffDeclined] = useState(false)

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.close-tally.unreadable-title')} error={error} onRetry={reload} />
	}

	const tally = value
	const name = tally.counterparty.name
	const owed = tally.balance.units > 0
	const owedToMe = tally.balance.perspective === 'owed-to-me'
	const closing = tally.closing
	const overdue = closing?.settleBy ? new Date(closing.settleBy).getTime() < Date.now() : false

	if (!closing) {
		return (
			<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
				<Card title={t('screens.close-tally.before-title')}>
					<Text style={styles.body}>{t('screens.close-tally.before-1')}</Text>
					<Text style={styles.body}>{t('screens.close-tally.before-2')}</Text>
					<Text style={styles.body}>{t('screens.close-tally.before-3')}</Text>
					<Text style={styles.caption}>{t('screens.close-tally.no-permission')}</Text>
				</Card>
				<Action
					label={t('screens.close-tally.request')}
					onPress={() => void requestClose(tallyId).then(reload)}
				/>
			</ScrollView>
		)
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Text style={styles.lead}>{t('screens.close-tally.closing-title')}</Text>
			<Text style={styles.caption}>
				{closing.requestedBy === 'both'
					? t('screens.close-tally.asked-by-both')
					: t(`screens.close-tally.asked-by-${closing.requestedBy === 'me' ? 'me' : 'them'}`, {
							name,
							date: formatInstant(closing.requested),
						})}
			</Text>

			<Card footnote={t('screens.close-tally.narrowed')}>
				{owed ? (
					<>
						<Row
							label={t('screens.close-tally.outstanding')}
							value={
								<Amount
									value={tally.balance}
									unit={tally.unit}
									perspective={tally.balance.perspective}
								/>
							}
						/>
						<Text style={styles.caption}>{t('screens.close-tally.awaiting')}</Text>
					</>
				) : (
					<Text style={styles.body}>{t('screens.close-tally.nothing-owed')}</Text>
				)}
				{closing.settleBy ? (
					<Text style={styles.caption}>
						{t('screens.close-tally.settle-by', { date: formatCivilDate(closing.settleBy) })}
					</Text>
				) : null}
				{overdue ? <Text style={styles.caption}>{t('screens.close-tally.overdue')}</Text> : null}
			</Card>

			{!tally.counterpartyReachable ? (
				<Card title={t('screens.close-tally.unworkable-title')}>
					<Text style={styles.caption}>{t('screens.close-tally.unworkable-body')}</Text>
				</Card>
			) : null}

			{/* The party owing settles; the party owed may hand the balance back —
			    both are permitted because both move the balance to zero. */}
			{owed && !owedToMe ? (
				<Action
					label={t('screens.close-tally.settle')}
					onPress={() =>
						navigation.navigate('PayPartner', {
							tallyId,
							amount: tally.balance.units / divisorOf(tally.unit),
						})
					}
				/>
			) : null}

			{owed && owedToMe && !closing.offerWriteOff ? (
				<Card footnote={t('screens.close-tally.return-note')}>
					<Action
						label={t('screens.close-tally.return-balance')}
						onPress={() =>
							navigation.navigate('PayPartner', {
								tallyId,
								amount: tally.balance.units / divisorOf(tally.unit),
							})
						}
						secondary
					/>
				</Card>
			) : null}

			{/* Path A: offered only to the party owed it, once, without nagging. */}
			{owed && owedToMe && closing.offerWriteOff && !writeOffDeclined ? (
				<Card title={t('screens.close-tally.writeoff-title')}>
					<Text style={styles.caption}>
						{t('screens.close-tally.writeoff-body', { amount: figure(tally) })}
					</Text>
					<Action
						label={t('screens.close-tally.writeoff-do', { amount: figure(tally) })}
						onPress={() =>
							navigation.navigate('PayPartner', {
								tallyId,
								amount: tally.balance.units / divisorOf(tally.unit),
							})
						}
					/>
					<Action
						label={t('screens.close-tally.writeoff-decline')}
						onPress={() => setWriteOffDeclined(true)}
						secondary
					/>
				</Card>
			) : null}
			{writeOffDeclined ? (
				<Text style={styles.caption}>{t('screens.close-tally.writeoff-declined')}</Text>
			) : null}

			{closing.requestedBy !== 'them' ? (
				<Card footnote={t('screens.close-tally.withdraw-note')}>
					<Action
						label={t('screens.close-tally.withdraw')}
						onPress={() => void withdrawClose(tallyId).then(reload)}
						secondary
					/>
					{closing.requestedBy === 'both' ? (
						<Text style={styles.caption}>{t('screens.close-tally.withdraw-blocked')}</Text>
					) : null}
				</Card>
			) : null}
		</ScrollView>
	)
}

/**
 * The remainder as a person reads it. Not `units / divisor`: a unit that divides
 * by sixty makes that a fraction of an hour, which is not what anybody says.
 */
function figure(tally: TallyDetail): string {
	return amountText(tally.balance, tally.unit)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	lead: { ...typography.title, color: tokens.textPrimary },
	body: { ...typography.body, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary },
})
