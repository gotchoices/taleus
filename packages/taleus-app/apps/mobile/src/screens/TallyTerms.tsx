import { useCallback } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { Action, Amount, Card, Chip, Failed, Loading, OpenableRow, Row } from '../components'
import {
	readAgreement,
	readTally,
	readTerms,
	type AgreementDocument,
	type TallyDetail,
	type TermsChange,
	type TermsProposal,
	type TermsRecord,
} from '../data/tally'
import type { DataError, Result, Unit } from '../data/types'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'
import { fieldLabel } from '../util/fields'
import { formatCivilDate } from '../util/date'

type Props = ScreenProps<'TallyTerms'>

interface TermsPage {
	tally: TallyDetail
	terms: TermsRecord
	agreement?: AgreementDocument
	/** Why the contract is missing, when it is. The terms still read. */
	agreementError?: DataError
}

/**
 * TallyTerms (story 07) — what is in force, how it got there, and what it was
 * agreed under.
 *
 * The distinction the whole screen turns on is *when a figure governs*. A raise
 * applies at once; a reduction waits out the notice period, and even then it
 * does not reach back — what is already outstanding stays under the terms it was
 * advanced under. So there are three separate places a figure can be: in force
 * today, agreed and waiting, and merely proposed. Collapsing any two of them
 * would tell the reader they may do something they may not, or the reverse.
 */
export function TallyTerms({ route, navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { tallyId } = route.params

	const load = useCallback(async (): Promise<Result<TermsPage>> => {
		const detail = await readTally(tallyId)
		if (!detail.ok) {
			return detail
		}
		const terms = await readTerms(tallyId)
		if (!terms.ok) {
			return terms
		}
		// The contract is fetched separately and is allowed to fail: story 07's
		// error case is exactly this, with the terms in force still readable.
		const document = await readAgreement(detail.value.agreement.id)
		return {
			ok: true,
			value: {
				tally: detail.value,
				terms: terms.value,
				agreement: document.ok ? document.value : undefined,
				agreementError: document.ok ? undefined : document.error,
			},
		}
	}, [tallyId])

	const { state, value, error, reload } = useLoad(load)

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.tally-terms.unreadable-title')} error={error} onRetry={reload} />
	}

	const { tally, terms, agreement, agreementError } = value
	const name = tally.counterparty.name
	const today = new Date().toISOString().slice(0, 10)
	// Soonest first: these are read as "next this happens, then that", which is
	// the opposite order from the history below it.
	const coming = terms.history
		.filter(change => change.effective > today)
		.slice()
		.sort((a, b) => a.effective.localeCompare(b.effective))
	const settled = tally.balance.units === 0

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			{tally.state !== 'Open' ? (
				<View>
					<Chip label={t(`screens.tally-view.state-${tally.state.toLowerCase()}`)} />
					<Text style={styles.caption}>{t('screens.tally-terms.closed-note')}</Text>
				</View>
			) : null}

			{/* Both directions, from this party's own point of view, each with the
			    date it took effect — the two sides took effect on different days. */}
			<Card title={t('screens.tally-terms.in-force')}>
				<Row
					label={t('screens.tally-terms.i-extend', { name })}
					note={`${notice(tally.terms.mine.noticeDays)} · ${t('screens.tally-terms.since', { date: formatCivilDate(tally.terms.mine.effective) })}`}
					value={<Amount value={tally.terms.mine.creditLimit} unit={tally.unit} />}
				/>
				<Row
					label={t('screens.tally-terms.they-extend', { name })}
					note={`${notice(tally.terms.theirs.noticeDays)} · ${t('screens.tally-terms.since', { date: formatCivilDate(tally.terms.theirs.effective) })}`}
					value={<Amount value={tally.terms.theirs.creditLimit} unit={tally.unit} />}
				/>
			</Card>

			{coming.length > 0 ? (
				<Card title={t('screens.tally-terms.coming')} footnote={t('screens.tally-terms.coming-note')}>
					{coming.map(change => (
						<View key={change.id} style={styles.block}>
							{/* The figure is rendered, never interpolated: the app's notation
							    is a fraction over a rule, and a string would put a decimal
							    point back into it. */}
							<Row
								label={t('screens.tally-terms.becomes-on', {
									date: formatCivilDate(change.effective),
								})}
								note={`${
									change.side === 'mine'
										? t('screens.tally-terms.i-extend', { name })
										: t('screens.tally-terms.they-extend', { name })
								} · ${t('screens.tally-terms.agreed-on', { date: formatCivilDate(change.agreed) })}`}
								value={<Amount value={change.creditLimit} unit={tally.unit} />}
							/>
							{change.governs === 'new-activity' ? (
								<Text style={styles.meta}>{t('screens.tally-terms.governs-new')}</Text>
							) : null}
						</View>
					))}
					{/* Path D step 2 and path E step 2 — the two things a reader would
					    otherwise have to infer, and would infer wrongly. */}
					<Text style={styles.caption}>
						{settled
							? t('screens.tally-terms.immediate')
							: t('screens.tally-terms.governs-outstanding')}
					</Text>
					{coming.length > 1 ? (
						<Text style={styles.caption}>{t('screens.tally-terms.stacking')}</Text>
					) : null}
				</Card>
			) : null}

			{terms.proposal ? <Proposal proposal={terms.proposal} name={name} unit={tally.unit} /> : null}

			<Card title={t('screens.tally-terms.history')}>
				{terms.history.every(change => change.opening) ? (
					<Text style={styles.caption}>{t('screens.tally-terms.no-amendments')}</Text>
				) : null}
				{terms.history.map((change, index) => (
					<Change
						key={change.id}
						change={change}
						previous={previousOnSameSide(terms.history, index)}
						name={name}
						unit={tally.unit}
						future={change.effective > today}
					/>
				))}
			</Card>

			{agreement ? (
				<Card title={t('screens.tally-terms.agreement')}>
					<Text style={styles.body}>{agreement.title}</Text>
					<Text style={styles.meta}>
						{t('screens.tally-terms.agreement-meta', {
							publisher: agreement.publisher,
							version: agreement.version,
							language: agreement.language,
						})}
					</Text>
					{/* Step 5: the terms are arguments to this document, and the reader
					    can see which arguments rather than being asked to assume it. */}
					<Text style={styles.caption}>
						{t('screens.tally-terms.agreement-parameters', {
							fields: agreement.parameters.map(termLabel).join(', '),
						})}
					</Text>
					{agreement.sections.map(section => (
						<View key={section.heading} style={styles.block}>
							<Text style={styles.heading}>{section.heading}</Text>
							<Text style={styles.body}>{section.body}</Text>
						</View>
					))}
				</Card>
			) : (
				<Card title={t('screens.tally-terms.agreement')}>
					<Text style={styles.caption}>{t('screens.tally-terms.agreement-unavailable')}</Text>
					{agreementError?.message ? (
						<Text style={styles.meta}>{agreementError.message}</Text>
					) : null}
					{agreementError?.retryable ? (
						<Action label={t('screens.tally-terms.agreement-retry')} onPress={reload} secondary />
					) : null}
				</Card>
			)}

			<Card title={t('screens.tally-terms.who', { name })} footnote={t('screens.tally-terms.who-note')}>
				{Object.entries(tally.counterparty.disclosed ?? {}).map(([field, disclosed]) => (
					<Row key={field} label={fieldLabel(field)} value={disclosed} />
				))}
				{/* Path C: if what is absent matters, asking is the way past it. */}
				<OpenableRow
					// `DisclosureView` lives in the settings stack, so this crosses tabs
					// rather than pushing — the same move `Attention` makes the other way.
					onPress={() =>
						navigation.navigate('SettingsTab', {
							screen: 'DisclosureView',
							params: { tallyId: tally.id },
						})
					}
					accessibilityLabel={t('screens.tally-terms.who-open')}
				>
					<Text style={styles.body}>{t('screens.tally-terms.who-open')}</Text>
				</OpenableRow>
			</Card>
		</ScrollView>
	)
}

/**
 * Path A. A proposal is neither in force nor waiting to be — it is one party's
 * suggestion, and the card says who is waiting on whom.
 */
function Proposal({
	proposal,
	name,
	unit,
}: {
	proposal: TermsProposal
	name: string
	unit: Unit
}): React.JSX.Element {
	const styles = useStyles(make)
	const params = { name, date: formatCivilDate(proposal.proposed) }
	return (
		<Card
			title={t('screens.tally-terms.proposed')}
			footnote={t('screens.tally-terms.proposed-note')}
		>
			<Row
				label={
					proposal.side === 'mine'
						? t('screens.tally-terms.i-extend', { name })
						: t('screens.tally-terms.they-extend', { name })
				}
				value={<Amount value={proposal.creditLimit} unit={unit} />}
			/>
			<Text style={styles.body}>
				{proposal.by === 'me'
					? t('screens.tally-terms.proposed-by-me', params)
					: t('screens.tally-terms.proposed-by-them', params)}
			</Text>
		</Card>
	)
}

/** One agreed set, with what changed about it and when it took hold. */
function Change({
	change,
	previous,
	name,
	unit,
	future,
}: {
	change: TermsChange
	previous?: TermsChange
	name: string
	unit: Unit
	future: boolean
}): React.JSX.Element {
	const styles = useStyles(make)
	const limitChanged = previous && previous.creditLimit.units !== change.creditLimit.units
	const noticeChanged = previous && previous.noticeDays !== change.noticeDays

	return (
		<View style={styles.block}>
			<View style={styles.changeTop}>
				<Text style={styles.body}>
					{change.side === 'mine'
						? t('screens.tally-terms.i-extend', { name })
						: t('screens.tally-terms.they-extend', { name })}
				</Text>
				<Amount value={change.creditLimit} unit={unit} size="small" />
			</View>
			{change.opening ? (
				<Text style={styles.meta}>{t('screens.tally-terms.opening')}</Text>
			) : null}
			{limitChanged && previous ? (
				<View style={styles.was}>
					<Text style={styles.meta}>{t('screens.tally-terms.was')}</Text>
					<Amount value={previous.creditLimit} unit={unit} size="small" />
				</View>
			) : null}
			<Text style={styles.meta}>
				{noticeChanged && previous
					? // The figure that decides the form is the one it becomes.
						t('screens.tally-terms.changed-notice', {
							count: change.noticeDays,
							from: previous.noticeDays,
							to: change.noticeDays,
						})
					: notice(change.noticeDays)}
			</Text>
			<Text style={styles.meta}>
				{change.by === 'me'
					? t('screens.tally-terms.by-me')
					: t('screens.tally-terms.by-them', { name })}
				{' · '}
				{t('screens.tally-terms.agreed-on', { date: formatCivilDate(change.agreed) })}
				{' · '}
				{future
					? t('screens.tally-terms.takes-effect', { date: formatCivilDate(change.effective) })
					: t('screens.tally-terms.took-effect', { date: formatCivilDate(change.effective) })}
			</Text>
		</View>
	)
}

/** The one before it on the same side — what "changed" is measured against. */
function previousOnSameSide(history: TermsChange[], index: number): TermsChange | undefined {
	return history.slice(index + 1).find(change => change.side === history[index].side)
}

function notice(days: number): string {
	return t('screens.tally-terms.notice', { count: days, days })
}

/** A contract's parameter, named the way the terms above name it. */
function termLabel(parameter: string): string {
	return parameter === 'creditLimit' ? 'the limit' : 'the notice period'
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	block: { gap: spacing[0], paddingVertical: spacing[0] },
	was: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing[1] },
	changeTop: {
		flexDirection: 'row' as const,
		justifyContent: 'space-between' as const,
		alignItems: 'center' as const,
		gap: spacing[2],
	},
	heading: { ...typography.small, color: tokens.textSecondary },
	body: { ...typography.body, color: tokens.textPrimary, flexShrink: 1 },
	caption: { ...typography.caption, color: tokens.textSecondary },
	meta: { ...typography.small, color: tokens.textSecondary },
})
