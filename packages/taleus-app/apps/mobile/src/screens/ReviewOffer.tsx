import { useCallback, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'

import { Action, Amount, Card, Empty, Failed, Loading, Row, unitNamesFor } from '../components'
import { readOffer, respondToOffer, type Change, type Offer, type ProposedTerms } from '../data/offers'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import { divisorOf } from '../util/amount'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, useTokens, spacing, touchTarget, type as typography, type Tokens } from '../theme'
import { formatInstant } from '../util/date'

type Props = ScreenProps<'ReviewOffer'>

/**
 * ReviewOffer (story 03) — terms waiting on this party.
 *
 * Two things the story insists on, and they shape the whole screen.
 *
 * **A counter is a new offer, not an edit.** `docs/architecture.md` § Offer
 * semantics: a proposal is identified, ordered, and carries an expiry, and more
 * than one may be outstanding. So countering is presented as replacing the
 * agreement — its own section, below accepting, saying the other party now has
 * to agree — rather than as fields on a live agreement that a party edits in
 * place.
 *
 * **What changed comes first.** Step 3 is Jan seeing exactly what Sam changed:
 * the notice period, nothing else. A screen that only showed the new terms would
 * make the reader diff two offers in their head.
 */
export function ReviewOffer({ route }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { tallyId } = route.params
	const { state, value, error, reload } = useLoad(useCallback(() => readOffer(tallyId), [tallyId]))

	const [limit, setLimit] = useState('')
	const [notice, setNotice] = useState('')
	const [outcome, setOutcome] = useState<'accepted' | 'countered' | undefined>()

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed') {
		return <Failed title={t('screens.review-offer.unreadable-title')} error={error} onRetry={reload} />
	}
	if (!value) {
		return (
			<Empty title={t('screens.review-offer.none-title')} body={t('screens.review-offer.none-body')} />
		)
	}
	if (outcome) {
		return <Empty title={t(`screens.review-offer.${outcome}`)} />
	}
	if (value.supersededBy) {
		return <Superseded offer={value} />
	}

	const name = value.counterparty.name
	const send = async (answer: 'accept' | 'counter') => {
		const terms: ProposedTerms = {
			mine: {
				creditLimit: {
					units: limit
						? Math.round(Number(limit) * divisorOf(value.unit))
						: value.proposed.mine.creditLimit.units,
				},
				noticeDays: notice ? Number(notice) : value.proposed.mine.noticeDays,
			},
			theirs: value.proposed.theirs,
		}
		const result = await respondToOffer(tallyId, answer, terms)
		if (result.ok) {
			setOutcome(result.value)
		}
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Text style={styles.lead}>{t('screens.review-offer.who', { name })}</Text>

			{/* Step 3: exactly what changed, before the terms themselves. */}
			<Card title={t('screens.review-offer.changed-title')}>
				{value.changes.length === 0 ? (
					<Text style={styles.caption}>{t('screens.review-offer.changed-none')}</Text>
				) : (
					value.changes.map(change => (
						<Text key={change.field} style={styles.body}>
							{t('screens.review-offer.change-line', {
								field: fieldName(change),
								from: change.from,
								to: change.to,
							})}
						</Text>
					))
				)}
			</Card>

			<Card
				title={t('screens.review-offer.proposed-title')}
				footnote={
					value.inForce
						? t('screens.review-offer.in-force-note')
						: t('screens.review-offer.forming-note')
				}
			>
				<Row
					label={t('screens.review-offer.i-extend')}
					note={t('screens.review-offer.notice-days', {
						count: value.proposed.mine.noticeDays,
						days: value.proposed.mine.noticeDays,
					})}
					value={<Amount value={value.proposed.mine.creditLimit} unit={value.unit} />}
				/>
				<Row
					label={t('screens.review-offer.they-extend', { name })}
					note={t('screens.review-offer.notice-days', {
						count: value.proposed.theirs.noticeDays,
						days: value.proposed.theirs.noticeDays,
					})}
					value={<Amount value={value.proposed.theirs.creditLimit} unit={value.unit} />}
				/>
				<Row label={t('screens.review-offer.counts-in')} value={unitNamesFor(value.unit).code} />
				<Text style={styles.caption}>{t('screens.review-offer.unit-fixed')}</Text>
			</Card>

			{value.expires ? (
				<Text style={styles.caption}>
					{t('screens.review-offer.expires', { date: formatInstant(value.expires) })}
				</Text>
			) : null}

			<Action label={t('screens.review-offer.accept')} onPress={() => void send('accept')} />

			<Card
				title={t('screens.review-offer.counter-title')}
				footnote={t('screens.review-offer.counter-note', { name })}
			>
				<View style={styles.field}>
					<Text style={styles.body}>{t('screens.review-offer.counter-mine-limit')}</Text>
					<Input
						label={t('screens.review-offer.counter-mine-limit')}
						value={limit}
						onChangeText={setLimit}
						keyboardType="numeric"
						placeholder={String(value.proposed.mine.creditLimit.units / divisorOf(value.unit))}
					/>
				</View>
				<View style={styles.field}>
					<Text style={styles.body}>{t('screens.review-offer.counter-mine-notice')}</Text>
					<Input
						label={t('screens.review-offer.counter-mine-notice')}
						value={notice}
						onChangeText={setNotice}
						keyboardType="numeric"
						placeholder={String(value.proposed.mine.noticeDays)}
					/>
				</View>
				<Action
					label={t('screens.review-offer.counter-send')}
					onPress={() => void send('counter')}
					secondary
				/>
			</Card>
		</ScrollView>
	)
}

/**
 * Path A: both proposals ended up fully signed. Neither party is left believing
 * something different is in force, so the screen names which took effect and
 * which was superseded, and says either may propose again from here.
 */
function Superseded({ offer }: { offer: Offer }): React.JSX.Element {
	const styles = useStyles(make)
	const governs = offer.supersededBy
	if (!governs) {
		return <Empty title={t('screens.review-offer.none-title')} />
	}
	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Text style={styles.lead}>{t('screens.review-offer.superseded-title')}</Text>
			<Text style={styles.caption}>{t('screens.review-offer.superseded-body')}</Text>

			<Card title={t('screens.review-offer.superseded-governs', { date: formatInstant(governs.drafted) })}>
				<Row
					label={t('screens.review-offer.they-extend', { name: offer.counterparty.name })}
					note={t('screens.review-offer.notice-days', {
						count: governs.proposed.theirs.noticeDays,
						days: governs.proposed.theirs.noticeDays,
					})}
					value={<Amount value={governs.proposed.theirs.creditLimit} unit={offer.unit} />}
				/>
			</Card>

			<Card title={t('screens.review-offer.superseded-was', { date: formatInstant(offer.drafted) })}>
				<Row
					label={t('screens.review-offer.they-extend', { name: offer.counterparty.name })}
					note={t('screens.review-offer.notice-days', {
						count: offer.proposed.theirs.noticeDays,
						days: offer.proposed.theirs.noticeDays,
					})}
					value={<Amount value={offer.proposed.theirs.creditLimit} unit={offer.unit} />}
				/>
			</Card>

			<Text style={styles.caption}>{t('screens.review-offer.superseded-onward')}</Text>
		</ScrollView>
	)
}

/** A change names a side and a field; both matter to the reader. */
function fieldName(change: Change): string {
	const key = `screens.review-offer.field-${change.field.replace('.', '-')}`
	const named = t(key)
	return named === key ? change.field : named
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
