import { useCallback, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'

import { Action, Amount, Card, Empty, Failed, Loading, Row, unitNamesFor } from '../components'
import { readInvitation, respondToInvitation, type OpenInvitation } from '../data/invitations'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, useTokens, spacing, touchTarget, type as typography, type Tokens } from '../theme'
import { formatInstant } from '../util/date'

type Props = ScreenProps<'ReviewInvitation'>

/**
 * ReviewInvitation (story 02) — the invitee's side, and the universal-link
 * landing.
 *
 * The order on screen is the order of story 02's steps, and it is the point of
 * the screen: what is being offered and under which agreement comes *first*,
 * read while the party has disclosed nothing (step 4). Only then is anything
 * asked of them (steps 5 and 6). Reversing it would have them paying before
 * they know the price.
 */
export function ReviewInvitation({ route }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { token } = route.params
	const { state, value, error, reload } = useLoad(
		useCallback(() => readInvitation(token), [token]),
	)

	const [disclosed, setDisclosed] = useState<Record<string, string>>({})
	const [limit, setLimit] = useState('0')
	const [notice, setNotice] = useState('14')
	const [outcome, setOutcome] = useState<'accepted' | 'refused' | undefined>()

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.review-invitation.unreadable-title')} error={error} onRetry={reload} />
	}

	// Story 02 path C: expiry is a distinct screen with a way forward, not an error.
	if (value.state === 'expired') {
		return (
			<Empty
				title={t('screens.review-invitation.expired-title')}
				body={t('screens.review-invitation.expired-body')}
			>
				<Action label={t('screens.review-invitation.expired-action')} />
			</Empty>
		)
	}

	if (outcome) {
		return (
			<Empty
				title={t(`screens.review-invitation.${outcome}`)}
				body={outcome === 'refused' ? t('screens.review-invitation.refused-onward') : undefined}
			/>
		)
	}

	const name = (disclosed.name ?? '').trim()
	const respond = async (answer: 'accept' | 'refuse') => {
		const result = await respondToInvitation(token, answer, {
			disclose: disclosed,
			creditLimit: { units: Math.round(Number(limit || '0') * 10 ** value.unit.scale) },
			noticeDays: Number(notice || '0'),
		})
		if (result.ok) {
			setOutcome(result.value)
		}
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Text style={styles.lead}>
				{t('screens.review-invitation.who', { name: inviterName(value) })}
			</Text>

			<Card footnote={t('screens.review-invitation.nothing-disclosed')}>
				<Row
					label={t('screens.review-invitation.their-limit')}
					value={<Amount value={value.theirCreditLimit} unit={value.unit} />}
				/>
				<Row
					label={t('screens.review-invitation.their-notice', {
						count: value.theirNoticeDays,
						days: value.theirNoticeDays,
					})}
				/>
				{/* Never the raw identifier: `iso4217:USD` is a machine's name for a
				    thing everyone else calls dollars (`domain/amounts.md`). */}
				<Row
					label={t('screens.review-invitation.counts-in')}
					value={unitNamesFor(value.unit).code}
				/>
			</Card>

			<Card title={t('screens.review-invitation.agreement')} footnote={value.agreement.summary}>
				<Text style={styles.body}>{value.agreement.title}</Text>
				<Text style={styles.meta}>
					{t('screens.tally-view.agreement-meta', {
						publisher: value.agreement.publisher,
						language: value.agreement.language,
					})}
				</Text>
			</Card>

			<Card title={t('screens.review-invitation.about-you')}>
				{value.asks.map(ask => (
					<View key={ask.field} style={styles.field}>
						<Text style={styles.body}>
							{t(`disclosure.${ask.field}`)}
							{'  '}
							<Text style={styles.meta}>
								{ask.required
									? t('screens.review-invitation.required')
									: t('screens.review-invitation.optional')}
							</Text>
						</Text>
						<Input
							label={t(`disclosure.${ask.field}`)}
							value={disclosed[ask.field] ?? ''}
							onChangeText={text => setDisclosed(prev => ({ ...prev, [ask.field]: text }))}
						/>
					</View>
				))}
			</Card>

			<Card footnote={t('screens.review-invitation.zero-is-fine')}>
				<View style={styles.field}>
					<Text style={styles.body}>{t('screens.review-invitation.your-terms')}</Text>
					<Input label={t('screens.review-invitation.your-terms')} value={limit} onChangeText={setLimit} keyboardType="numeric" />
				</View>
				<View style={styles.field}>
					<Text style={styles.body}>{t('screens.review-invitation.your-notice')}</Text>
					<Input label={t('screens.review-invitation.your-notice')} value={notice} onChangeText={setNotice} keyboardType="numeric" />
				</View>
			</Card>

			<Text style={styles.caption}>
				{t('screens.create-invitation.expires', { date: formatInstant(value.expires) })}
			</Text>
			<Action
				label={t('screens.review-invitation.accept')}
				onPress={name ? () => void respond('accept') : undefined}
			/>
			{name ? null : <Text style={styles.caption}>{t('screens.review-invitation.name-needed')}</Text>}
			<Action label={t('screens.review-invitation.refuse')} onPress={() => void respond('refuse')} secondary />
		</ScrollView>
	)
}

/** Only what the inviter chose to disclose — never anything the invitee typed. */
function inviterName(invitation: OpenInvitation): string {
	return invitation.inviter.disclosed?.name ?? invitation.inviter.sid
}

function Input({
	label,
	...props
}: { label: string } & React.ComponentProps<typeof TextInput>): React.JSX.Element {
	const styles = useStyles(make)
	const tokens = useTokens()
	return (
		<TextInput
			accessibilityLabel={label}
			placeholderTextColor={tokens.textSecondary}
			autoCorrect={false}
			{...props}
			style={styles.input}
		/>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	field: { gap: spacing[0] },
	lead: { ...typography.title, color: tokens.textPrimary },
	body: { ...typography.body, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary },
	meta: { ...typography.small, color: tokens.textSecondary },
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
