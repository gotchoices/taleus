import { useCallback } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { Card, Failed, Loading, PublisherNote } from '../components'
import { readAgreement, type AgreementSection, type TextRun } from '../data/tally'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'

type Props = ScreenProps<'Agreement'>

/**
 * Agreement (stories 01, 02, 07, 08) — an agreement, read in full.
 *
 * Who stands behind it comes first, because that is what most parties judge an agreement by; the
 * text follows, numbered as its publisher wrote it, with each included document named where it
 * begins. A tally's agreement is read from the tally itself (story 07 step 5), so it reads the same
 * whether or not its publisher still serves it. One that cannot be read in full says so: nobody
 * should be bound by text they cannot read (story 02 path E).
 */
export function Agreement({ route }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { agreementId, tallyId } = route.params
	const { state, value, error, reload } = useLoad(
		useCallback(() => readAgreement(agreementId, tallyId), [agreementId, tallyId]),
	)

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.agreement.unreadable-title')} error={error} onRetry={reload} />
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<View style={styles.head}>
				<Text style={styles.title} accessibilityRole="header">
					{value.title}
				</Text>
				<PublisherNote agreement={value} />
				<Text style={styles.meta}>
					{value.version
						? t('screens.agreement.version', { version: value.version, language: value.language })
						: t('screens.agreement.language', { language: value.language })}
				</Text>
				{/* Story 07 step 5: a tally's terms are arguments to this document. */}
				{tallyId && value.parameters.length > 0 ? (
					<Text style={styles.caption}>
						{t('screens.agreement.parameters', { fields: value.parameters.join(', ') })}
					</Text>
				) : null}
			</View>

			{value.preamble ? <Paragraph runs={value.preamble} /> : null}

			<Card>
				{value.sections.map(section => (
					<Section key={section.number} section={section} depth={0} />
				))}
			</Card>

			<Text style={styles.caption}>{t('screens.agreement.exact', { id: value.id })}</Text>
		</ScrollView>
	)
}

/** One numbered section and everything under it. */
function Section({ section, depth }: { section: AgreementSection; depth: number }): React.JSX.Element {
	const styles = useStyles(make)
	// An untitled section is a numbered paragraph: its number runs into the text, as printed.
	const inline = !section.title && section.text !== undefined
	return (
		<View style={[styles.section, depth > 0 ? styles.nested : null]}>
			{inline ? null : (
				<Text style={depth === 0 ? styles.heading : styles.subheading} accessibilityRole="header">
					{[section.number, section.title].filter(Boolean).join('  ')}
				</Text>
			)}
			{section.included ? (
				<Text style={styles.meta}>
					{t('screens.agreement.included', { publisher: section.included.publisher || t('publisher.unnamed') })}
				</Text>
			) : null}
			{section.text ? <Paragraph runs={section.text} number={inline ? section.number : undefined} /> : null}
			{section.sections.map(child => (
				<Section key={child.number} section={child} depth={depth + 1} />
			))}
		</View>
	)
}

/** A paragraph, its emphasis kept: nested `Text` so it wraps as one block. */
function Paragraph({ runs, number }: { runs: TextRun[]; number?: string }): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<Text style={styles.body}>
			{number ? <Text style={styles.number}>{`${number}  `}</Text> : null}
			{runs.map((run, index) => (
				<Text
					key={index}
					style={[
						run.bold ? styles.bold : null,
						run.italic ? styles.italic : null,
						run.underline ? styles.underline : null,
						run.reference || run.parameter ? styles.marked : null,
					]}
				>
					{run.text}
				</Text>
			))}
		</Text>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	head: { gap: spacing[1] },
	title: { ...typography.title, color: tokens.textPrimary },
	section: { gap: spacing[1], paddingVertical: spacing[1] },
	nested: { paddingLeft: spacing[2] },
	heading: { ...typography.body, color: tokens.textPrimary, fontWeight: '600' as const },
	subheading: { ...typography.body, color: tokens.textPrimary, fontWeight: '500' as const },
	body: { ...typography.body, color: tokens.textPrimary },
	bold: { fontWeight: '700' as const },
	italic: { fontStyle: 'italic' as const },
	underline: { textDecorationLine: 'underline' as const },
	marked: { color: tokens.accent },
	number: { fontWeight: '600' as const },
	caption: { ...typography.caption, color: tokens.textSecondary },
	meta: { ...typography.small, color: tokens.textSecondary },
})
