import { useCallback, useMemo, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'

import { Action, Amount, Card, Empty, Failed, Loading, Row } from '../components'
import { previewEntry, recordEntry, type Preview } from '../data/entries'
import { readTally, type TallyDetail } from '../data/tally'
import type { DataError } from '../data/types'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, useTokens, spacing, touchTarget, type as typography, type Tokens } from '../theme'

type Props = ScreenProps<'PayPartner'>

/**
 * PayPartner (story 20) — recording value this party is giving.
 *
 * Three things the story is emphatic about, and they decide the screen:
 *
 * **It needs nobody's agreement** (step 4). There is no "send for approval";
 * the giver signs, and the counterparty does not agree to receive value.
 *
 * **The effect is shown before signing** (step 2): where the balance would
 * stand, and what room would be left.
 *
 * **The limit warns, it does not block** (path A). Going past what the
 * counterparty agreed to be owed is a pledge the party is entitled to make —
 * refusing to let them make it protects nobody, since the counterparty has given
 * up nothing by holding it. So the warning says how far past, and the button
 * stays live.
 */
export function PayPartner({ route }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const tokens = useTokens()
	const { tallyId } = route.params
	const { state, value, error, reload } = useLoad(useCallback(() => readTally(tallyId), [tallyId]))

	const [text, setText] = useState('')
	const [memo, setMemo] = useState('')
	const [preview, setPreview] = useState<Preview | undefined>()
	const [done, setDone] = useState(false)
	const [failure, setFailure] = useState<DataError | undefined>()

	// One id per attempt at one act: retrying must not record it twice (path D).
	const actId = useMemo(() => Math.random().toString(36).slice(2), [tallyId])

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.pay-partner.failed-title')} error={error} onRetry={reload} />
	}

	const tally: TallyDetail = value
	const units = Math.round(Number(text || '0') * 10 ** tally.unit.scale)
	const amount = { units }

	const look = async (next: string) => {
		setText(next)
		const parsed = Math.round(Number(next || '0') * 10 ** tally.unit.scale)
		if (!parsed) {
			setPreview(undefined)
			return
		}
		const result = await previewEntry(tallyId, { units: parsed })
		setPreview(result.ok ? result.value : undefined)
	}

	const sign = async () => {
		setFailure(undefined)
		const result = await recordEntry(tallyId, { actId, amount, memo: memo.trim() || undefined })
		if (result.ok) {
			setDone(true)
			return
		}
		setFailure(result.error)
	}

	if (done) {
		return (
			<Empty
				title={t('screens.pay-partner.recorded-title')}
				body={t('screens.pay-partner.recorded-body')}
			/>
		)
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Text style={styles.lead}>
				{t('screens.pay-partner.lead', { name: tally.counterparty.name })}
			</Text>

			<View style={styles.field}>
				<Text style={styles.body}>{t('screens.pay-partner.amount')}</Text>
				<TextInput
					accessibilityLabel={t('screens.pay-partner.amount')}
					value={text}
					onChangeText={next => void look(next)}
					keyboardType="numeric"
					placeholder="0"
					placeholderTextColor={tokens.textSecondary}
					style={styles.input}
				/>
			</View>

			<View style={styles.field}>
				<Text style={styles.body}>{t('screens.pay-partner.memo')}</Text>
				<TextInput
					accessibilityLabel={t('screens.pay-partner.memo')}
					value={memo}
					onChangeText={setMemo}
					placeholder={t('screens.pay-partner.memo-placeholder')}
					placeholderTextColor={tokens.textSecondary}
					style={styles.input}
				/>
				<Text style={styles.caption}>{t('screens.pay-partner.memo-note')}</Text>
			</View>

			{preview ? (
				<Card
					title={t('screens.pay-partner.effect-title')}
					footnote={t('screens.pay-partner.no-agreement-needed')}
				>
					<Row
						label={t('screens.pay-partner.balance-after')}
						value={
							<Amount
								value={preview.balanceAfter}
								unit={tally.unit}
								perspective={preview.balanceAfter.perspective}
							/>
						}
					/>
					<Row
						label={t('screens.pay-partner.room-after')}
						value={<Amount value={preview.roomAfter} unit={tally.unit} />}
					/>
				</Card>
			) : null}

			{preview?.beyondLimit ? (
				<Card title={t('screens.pay-partner.beyond-title')}>
					<Text style={styles.caption}>
						{t('screens.pay-partner.beyond-body', {
							amount: `${preview.beyondLimit.units / 10 ** tally.unit.scale}`,
							name: tally.counterparty.name,
						})}
					</Text>
				</Card>
			) : null}

			{failure ? (
				<Card title={t('screens.pay-partner.failed-title')}>
					<Text style={styles.caption}>{failure.message}</Text>
					<Text style={styles.caption}>{t('screens.pay-partner.nothing-changed')}</Text>
				</Card>
			) : null}

			{/* Live whenever there is an amount: past the limit is a warning, not a wall. */}
			<Action label={t('screens.pay-partner.sign')} onPress={units ? () => void sign() : undefined} />
			{units ? null : <Text style={styles.caption}>{t('screens.pay-partner.amount-needed')}</Text>}
		</ScrollView>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	field: { gap: spacing[1] },
	lead: { ...typography.title, color: tokens.textPrimary },
	body: { ...typography.body, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary },
	input: {
		...typography.body,
		color: tokens.textPrimary,
		backgroundColor: tokens.surfaceAlt,
		borderRadius: spacing[1],
		borderWidth: 1,
		borderColor: tokens.border,
		minHeight: touchTarget,
		paddingHorizontal: spacing[2],
	},
})
