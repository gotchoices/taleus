import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { Action, Failed } from '../components'
import { createIdentity } from '../data/party'
import type { DataError } from '../data/types'
import { t } from '../i18n'
import type { OnboardingProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'

type Props = OnboardingProps<'Welcome'>

/**
 * Welcome (story 10, steps 1–3) — what this is, before anything is asked.
 *
 * Story 10 path D is the constraint that shapes this screen: a person can see
 * what the app is for *without having created anything*. So the explanation
 * comes first and identity creation is a consequence of choosing to continue,
 * never a precondition for reading. Nothing here needs the network (path C).
 */
export function Welcome({ navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const [error, setError] = useState<DataError | undefined>()
	const [busy, setBusy] = useState(false)

	const start = async () => {
		setBusy(true)
		try {
			// Story 10 step 3: the app does this. No ceremony, nothing to choose.
			const result = await createIdentity()
			if (!result.ok) {
				setError(result.error)
				return
			}
			navigation.navigate('ChooseName')
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

	if (error) {
		return (
			<Failed
				title={t('screens.welcome.failed-title')}
				error={error}
				onRetry={() => setError(undefined)}
			/>
		)
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<View style={styles.blurb}>
				<Text style={styles.title}>{t('screens.welcome.title')}</Text>
				<Text style={styles.body}>{t('screens.welcome.what-it-is')}</Text>
				<Text style={styles.body}>{t('screens.welcome.what-value-is')}</Text>
				<Text style={styles.caption}>{t('screens.welcome.no-obligation')}</Text>
			</View>
			<Action label={t('screens.welcome.start')} onPress={busy ? undefined : () => void start()} />
		</ScrollView>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[4], flexGrow: 1, justifyContent: 'center' as const },
	blurb: { gap: spacing[2] },
	title: { fontSize: 34, fontWeight: '600' as const, color: tokens.textPrimary },
	body: { ...typography.body, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary },
})
