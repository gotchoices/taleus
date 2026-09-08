import { useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'

import { Action, Card } from '../components'
import { setDisplayName } from '../data/party'
import type { DataError } from '../data/types'
import { t } from '../i18n'
import type { OnboardingProps } from '../navigation/routes'
import { useStyles, useTokens, spacing, touchTarget, type as typography, type Tokens } from '../theme'

type Props = OnboardingProps<'ChooseName'>

/**
 * ChooseName (story 10, steps 4–5) — the one thing asked for up front.
 *
 * Steps 4 and 5 sit together deliberately: the party is *told* the identity
 * exists and lives on this device, then *asked* for a name. Everything else
 * about them waits until something needs it, and the story is explicit that
 * they are told so — story 11 is what makes that promise good.
 */
export function ChooseName({ onDone }: Props & { onDone?: () => void }): React.JSX.Element {
	const styles = useStyles(make)
	const tokens = useTokens()
	const [name, setName] = useState('')
	const [error, setError] = useState<DataError | undefined>()
	const [busy, setBusy] = useState(false)

	const trimmed = name.trim()

	const save = async () => {
		if (!trimmed) {
			return
		}
		setBusy(true)
		setError(undefined)
		try {
			const result = await setDisplayName(trimmed)
			if (!result.ok) {
				setError(result.error)
				return
			}
			onDone?.()
		} catch (thrown) {
			setError({
				kind: 'unexpected',
				message: thrown instanceof Error ? thrown.message : String(thrown),
				retryable: true,
			})
		} finally {
			setBusy(false)
		}
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Card>
				<Text style={styles.caption}>{t('screens.choose-name.identity-made')}</Text>
				<Text style={styles.caption}>{t('screens.choose-name.on-this-device')}</Text>
			</Card>

			<View style={styles.field}>
				<Text style={styles.body}>{t('screens.choose-name.ask')}</Text>
				<TextInput
					accessibilityLabel={t('screens.choose-name.ask')}
					value={name}
					onChangeText={setName}
					placeholder={t('screens.choose-name.placeholder')}
					placeholderTextColor={tokens.textSecondary}
					autoCapitalize="words"
					autoCorrect={false}
					returnKeyType="done"
					onSubmitEditing={() => void save()}
					style={styles.input}
				/>
				<Text style={styles.caption}>{t('screens.choose-name.deferred')}</Text>
			</View>

			{error ? (
				<Text style={styles.error}>
					{t('screens.choose-name.failed-title')}
					{error.message ? ` — ${error.message}` : ''}
				</Text>
			) : null}

			<Action
				label={t('screens.choose-name.continue')}
				onPress={trimmed && !busy ? () => void save() : undefined}
			/>
			{trimmed ? null : <Text style={styles.caption}>{t('screens.choose-name.needed')}</Text>}
		</ScrollView>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	field: { gap: spacing[1] },
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
