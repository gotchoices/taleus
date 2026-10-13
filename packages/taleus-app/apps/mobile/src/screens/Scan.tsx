import { useIsFocused } from '@react-navigation/native'
import { useState } from 'react'
import { Text } from 'react-native'

import { Action, Card, CodeCamera, FormScroll, Input } from '../components'
import { inviteToken } from '../data/inviteLink'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'

type Props = ScreenProps<'Scan'>

/**
 * Scan (story 02, `specs/mobile/screens/scan.md`) — open what someone handed over in person.
 *
 * The camera reads a code; the field takes a pasted link. Either way an invitation opens
 * `ReviewInvitation`, where the party reads the terms: nothing is accepted here. A code that is not
 * an invitation is said to be so, and the camera keeps looking.
 */
export function Scan({ navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const focused = useIsFocused()
	const [pasted, setPasted] = useState('')
	const [unknown, setUnknown] = useState(false)

	const review = (token: string) => navigation.navigate('ReviewInvitation', { token })

	const scanned = (value: string) => {
		const token = inviteToken(value)
		setUnknown(!token)
		if (token) review(token)
	}

	// Pasted text may be the link or the bare invitation; `ReviewInvitation` says when it is neither.
	const open = () => review(inviteToken(pasted) ?? pasted.trim())

	return (
		<FormScroll style={styles.screen} contentContainerStyle={styles.content}>
			<Card title={t('screens.scan.camera')}>
				<CodeCamera active={focused} onCode={scanned} />
				{unknown ? <Text style={styles.warn}>{t('screens.scan.not-invitation')}</Text> : null}
			</Card>
			<Card title={t('screens.scan.paste')}>
				<Input
					label={t('screens.scan.paste-label')}
					note={t('screens.scan.paste-note')}
					value={pasted}
					onChangeText={setPasted}
					autoCapitalize="none"
					autoCorrect={false}
				/>
				<Action label={t('screens.scan.open')} onPress={pasted.trim() ? open : undefined} />
			</Card>
		</FormScroll>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	warn: { ...typography.caption, color: tokens.textPrimary, fontWeight: '600' as const },
})
