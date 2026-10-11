import { Text, View } from 'react-native'

import type { Agreement } from '../data/invitations'
import { BUILT_IN_PUBLISHER } from '../data/publishers'
import { t } from '../i18n'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'

/**
 * Who stands behind an agreement (story 08), said the same way wherever one is shown.
 *
 * Few parties can judge an agreement by reading it, so this is what they judge it by. Three facts,
 * stated side by side and never merged into one verdict: who published it (always in full, so a
 * look-alike reads as itself), whether that publisher stands behind it, and whether this party
 * trusts it. A recommendation and the publisher's current word on it follow, as information. The
 * strongest warning is kept for a claimed publisher that does not stand behind it.
 */
export function PublisherNote({ agreement }: { agreement: Agreement }): React.JSX.Element {
	const styles = useStyles(make)
	const { publisher, standing } = agreement
	const lines: { text: string; tone: 'plain' | 'warn' | 'strong' }[] = []

	if (standing?.publisherConfirms === 'no') {
		lines.push({ text: t('publisher.not-confirmed', { publisher }), tone: 'strong' })
	} else {
		if (standing?.publisherConfirms === 'unknown') {
			lines.push({ text: t('publisher.unchecked', { publisher }), tone: 'plain' })
		}
		if (standing?.trust === 'publisher') lines.push({ text: t('publisher.trusted'), tone: 'plain' })
		if (standing?.trust === 'agreement') lines.push({ text: t('publisher.agreement-trusted'), tone: 'plain' })
		if (standing?.trust === 'none') lines.push({ text: t('publisher.untrusted'), tone: 'warn' })
	}
	if (standing && standing.recommendedBy.length > 0) {
		lines.push({ text: t('publisher.recommended-by', { publishers: standing.recommendedBy.join(', ') }), tone: 'plain' })
	}
	if (standing?.status === 'withdrawn') lines.push({ text: t('publisher.withdrawn', { publisher }), tone: 'warn' })
	if (standing?.status === 'superseded') lines.push({ text: t('publisher.superseded', { publisher }), tone: 'plain' })

	return (
		<View style={styles.note}>
			<Text style={styles.publisher}>
				{publisher === BUILT_IN_PUBLISHER && standing?.trust === 'built-in'
					? t('publisher.built-in', { publisher })
					: t('publisher.published-by', { publisher: publisher || t('publisher.unnamed') })}
			</Text>
			{lines.map(line => (
				<Text key={line.text} style={line.tone === 'strong' ? styles.strong : line.tone === 'warn' ? styles.warn : styles.plain}>
					{line.text}
				</Text>
			))}
		</View>
	)
}

/** Whether a party can agree to it without being warned: trusted, by its publisher or on its own. */
export function isTrusted(agreement: Agreement): boolean {
	const trust = agreement.standing?.trust
	return trust === undefined || trust !== 'none'
}

const make = (tokens: Tokens) => ({
	note: { gap: spacing[0] },
	publisher: { ...typography.small, color: tokens.textPrimary },
	plain: { ...typography.small, color: tokens.textSecondary },
	warn: { ...typography.small, color: tokens.textPrimary, fontWeight: '600' as const },
	strong: { ...typography.small, color: tokens.negative, fontWeight: '600' as const },
})
