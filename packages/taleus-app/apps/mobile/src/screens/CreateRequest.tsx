import { useCallback, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'

import { Action, Card, Empty, Failed, Loading } from '../components'
import { createRequest } from '../data/requests'
import { readTally } from '../data/tally'
import type { DataError } from '../data/types'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import { divisorOf } from '../util/amount'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, useTokens, spacing, touchTarget, type as typography, type Tokens } from '../theme'

type Props = ScreenProps<'CreateRequest'>

/**
 * CreateRequest (story 21) — asking a partner to be paid.
 *
 * The two things that make a request different from an entry are said on the
 * screen rather than left to be inferred: it **obliges the other party to
 * nothing** by itself, and it **does not tick** — no expiry field, because a
 * request stands until answered or withdrawn. An unpaid bill does not stop
 * existing because a month went by, so there is nothing here to set.
 */
export function CreateRequest({ route }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const tokens = useTokens()
	const { tallyId } = route.params
	const { state, value, error, reload } = useLoad(useCallback(() => readTally(tallyId), [tallyId]))

	const [text, setText] = useState('')
	const [memo, setMemo] = useState('')
	const [sent, setSent] = useState(false)
	const [failure, setFailure] = useState<DataError | undefined>()

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.create-request.failed-title')} error={error} onRetry={reload} />
	}
	if (sent) {
		return (
			<Empty
				title={t('screens.create-request.sent-title')}
				body={t('screens.create-request.sent-body')}
			/>
		)
	}

	const units = Math.round(Number(text || '0') * divisorOf(value.unit))
	const ask = async () => {
		setFailure(undefined)
		const result = await createRequest(tallyId, {
			amount: { units },
			memo: memo.trim() || undefined,
		})
		if (result.ok) {
			setSent(true)
			return
		}
		setFailure(result.error)
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Text style={styles.lead}>
				{t('screens.create-request.lead', { name: value.counterparty.name })}
			</Text>

			<View style={styles.field}>
				<Text style={styles.body}>{t('screens.create-request.amount')}</Text>
				<TextInput
					accessibilityLabel={t('screens.create-request.amount')}
					value={text}
					onChangeText={setText}
					keyboardType="numeric"
					placeholder="0"
					placeholderTextColor={tokens.textSecondary}
					style={styles.input}
				/>
			</View>

			<View style={styles.field}>
				<Text style={styles.body}>{t('screens.create-request.memo')}</Text>
				<TextInput
					accessibilityLabel={t('screens.create-request.memo')}
					value={memo}
					onChangeText={setMemo}
					placeholder={t('screens.create-request.memo-placeholder')}
					placeholderTextColor={tokens.textSecondary}
					style={styles.input}
				/>
				<Text style={styles.caption}>{t('screens.create-request.memo-note')}</Text>
			</View>

			<Card footnote={t('screens.create-request.not-a-clock')}>
				<Text style={styles.caption}>{t('screens.create-request.obliges-nothing')}</Text>
			</Card>

			{failure ? <Text style={styles.error}>{failure.message}</Text> : null}
			<Action label={t('screens.create-request.send')} onPress={units ? () => void ask() : undefined} />
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
	error: { ...typography.caption, color: tokens.negative },
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
