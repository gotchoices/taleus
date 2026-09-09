import { useCallback, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { Action, Amount, Card, Failed, Input, Loading, OpenableRow, Options, Row } from '../components'
import { listAgreements, type Agreement } from '../data/invitations'
import { readProfile, type Profile } from '../data/profile'
import {
	publishStanding,
	readStanding,
	withdrawStanding,
	type StandingInvitation as Standing,
} from '../data/standing'
import type { Result, Unit } from '../data/types'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'
import { divisorOf, unitLabel } from '../util/amount'
import { formatInstant } from '../util/date'
import { fieldLabel, fieldList } from '../util/fields'

type Props = ScreenProps<'StandingInvitation'>

interface Page {
	standing: Standing | null
	agreements: Agreement[]
	profile?: Profile
}

interface Draft {
	limit: string
	noticeDays: number
	denom: string
	agreementId: string
	disclose: string[]
	understood: boolean
}

const DOLLARS: Unit = { denom: 'iso4217:USD', scale: 2 }

/**
 * StandingInvitation (story 01 path C, story 10 path E) — one set of terms that
 * anyone may take up.
 *
 * An ordinary invitation waits for one answer. This waits for any number, and
 * that difference drives everything here: it does not run out on a timer, each
 * responder becomes a separate relationship the moment they accept, and what it
 * carries goes to people this party has not met. Which is why the disclosure it
 * carries is presented as public *before* it is published (story 11 path C) —
 * afterwards is too late for the only decision that mattered.
 */
export function StandingInvitation({ navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const load = useCallback(async (): Promise<Result<Page>> => {
		const standing = await readStanding()
		if (!standing.ok) {
			return standing
		}
		const [agreements, profile] = await Promise.all([listAgreements(), readProfile()])
		return {
			ok: true,
			value: {
				standing: standing.value,
				agreements: agreements.ok ? agreements.value : [],
				profile: profile.ok ? profile.value : undefined,
			},
		}
	}, [])

	const { state, value, error, reload } = useLoad(load)
	const [draft, setDraft] = useState<Draft | undefined>()

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.standing.unreadable-title')} error={error} onRetry={reload} />
	}

	const { standing, agreements, profile } = value
	const held = profile?.held.map(field => field.key) ?? []

	const begin = () =>
		setDraft({
			limit: '0',
			noticeDays: 14,
			denom: 'iso4217:USD',
			agreementId: agreements.find(agreement => agreement.recommended)?.id ?? agreements[0]?.id,
			// Nothing pre-selected: what goes out to strangers is a decision to
			// make, not a default to notice afterwards.
			disclose: [],
			understood: false,
		} as Draft)

	const publish = async (current: Draft) => {
		await publishStanding({
			unit: DOLLARS,
			creditLimit: { units: Math.round(Number(current.limit || '0') * divisorOf(DOLLARS)) },
			noticeDays: current.noticeDays,
			agreementId: current.agreementId,
			disclose: current.disclose,
		})
		setDraft(undefined)
		reload()
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Card>
				<Text style={styles.body}>{t('screens.standing.what')}</Text>
				{/* Story 10 path E step 2. Saying it here is the point: a party who
				    expects to be findable will otherwise wait to be found. */}
				<Text style={styles.caption}>{t('screens.standing.no-directory')}</Text>
				<Text style={styles.caption}>{t('screens.standing.before-any')}</Text>
			</Card>

			{draft ? (
				<Publisher
					draft={draft}
					agreements={agreements}
					held={held}
					onChange={setDraft}
					onPublish={() => void publish(draft)}
					onCancel={() => setDraft(undefined)}
				/>
			) : standing ? (
				<Published
					standing={standing}
					agreements={agreements}
					onOpenTally={tallyId =>
						navigation.navigate('Tallies', { screen: 'TallyView', params: { tallyId } })
					}
					onWithdraw={() => void withdrawStanding().then(() => reload())}
					onPublishAgain={begin}
				/>
			) : (
				<Card title={t('screens.standing.none-yet')}>
					<Action label={t('screens.standing.publish')} onPress={begin} />
				</Card>
			)}
		</ScrollView>
	)
}

function Published({
	standing,
	agreements,
	onOpenTally,
	onWithdraw,
	onPublishAgain,
}: {
	standing: Standing
	agreements: Agreement[]
	onOpenTally(tallyId: string): void
	onWithdraw(): void
	onPublishAgain(): void
}): React.JSX.Element {
	const styles = useStyles(make)
	const [copied, setCopied] = useState(false)
	const withdrawn = standing.state === 'withdrawn'
	const agreement = agreements.find(item => item.id === standing.agreementId)

	return (
		<>
			{withdrawn ? (
				<Card title={t('screens.standing.withdrawn')}>
					<Text style={styles.caption}>{t('screens.standing.withdrawn-note')}</Text>
					<Action label={t('screens.standing.publish-again')} onPress={onPublishAgain} />
				</Card>
			) : (
				<Card title={t('screens.standing.hand-out')} footnote={t('screens.standing.hand-out-note')}>
					<Text style={styles.link}>{standing.link}</Text>
					<Text style={styles.meta}>
						{t('screens.standing.live', { date: formatInstant(standing.published) })}
					</Text>
					<Action
						label={copied ? t('screens.standing.copied') : t('screens.standing.copy')}
						onPress={() => setCopied(true)}
						secondary
					/>
				</Card>
			)}

			<Card title={t('screens.standing.terms')} footnote={t('screens.standing.binds-you')}>
				<Row
					label={t('screens.standing.limit')}
					value={<Amount value={standing.creditLimit} unit={standing.unit} />}
				/>
				{standing.creditLimit.units === 0 ? (
					// Story 21 path A: extending nothing is not a lesser offer.
					<Text style={styles.caption}>{t('screens.standing.limit-note')}</Text>
				) : null}
				<Row
					label={t('screens.standing.notice')}
					value={t('screens.standing.notice-days', {
						count: standing.noticeDays,
						days: standing.noticeDays,
					})}
				/>
				<Row
					label={t('screens.standing.unit')}
					note={t('screens.standing.unit-note')}
					value={unitLabel(standing.unit.denom, standing.unit.label)}
				/>
				<Row
					label={t('screens.standing.agreement')}
					note={t('screens.standing.agreement-note')}
					value={agreement?.title ?? standing.agreementId}
				/>
			</Card>

			<Card title={t('screens.standing.disclose')}>
				<Text style={styles.body}>
					{standing.disclose.length > 0
						? fieldList(standing.disclose)
						: t('screens.standing.disclose-none')}
				</Text>
				{/* Story 11 path C: said here too, not only before publishing — a
				    party coming back to this screen is deciding whether to leave it up. */}
				<Text style={styles.warning}>{t('screens.standing.disclose-public')}</Text>
			</Card>

			<Card
				title={t('screens.standing.taken-up')}
				footnote={t('screens.standing.taken-up-note')}
			>
				{standing.takenUp.length === 0 ? (
					<Text style={styles.caption}>{t('screens.standing.taken-up-none')}</Text>
				) : (
					standing.takenUp.map(taker => (
						<OpenableRow
							key={taker.tallyId}
							onPress={() => onOpenTally(taker.tallyId)}
							accessibilityLabel={taker.name}
						>
							<Text style={styles.body}>{taker.name}</Text>
							<Text style={styles.meta}>
								{t('screens.standing.taken-at', { date: formatInstant(taker.at) })}
							</Text>
						</OpenableRow>
					))
				)}
			</Card>

			{withdrawn ? null : (
				<Card footnote={t('screens.standing.withdraw-note')}>
					<Action label={t('screens.standing.withdraw')} onPress={onWithdraw} secondary />
				</Card>
			)}
		</>
	)
}

function Publisher({
	draft,
	agreements,
	held,
	onChange,
	onPublish,
	onCancel,
}: {
	draft: Draft
	agreements: Agreement[]
	held: string[]
	onChange(next: Draft): void
	onPublish(): void
	onCancel(): void
}): React.JSX.Element {
	const styles = useStyles(make)
	const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })

	return (
		<>
			<Card title={t('screens.standing.terms')} footnote={t('screens.standing.binds-you')}>
				<Input
					label={t('screens.standing.limit')}
					value={draft.limit}
					onChangeText={limit => set({ limit })}
					keyboardType="numeric"
					note={t('screens.standing.limit-note')}
				/>
				<Input
					label={t('screens.standing.notice')}
					value={String(draft.noticeDays)}
					onChangeText={days => set({ noticeDays: Number(days || '0') })}
					keyboardType="numeric"
				/>
				<Text style={styles.heading}>{t('screens.standing.agreement')}</Text>
				<Options
					options={agreements.map(agreement => ({
						value: agreement.id,
						label: agreement.title,
						note: agreement.summary,
					}))}
					chosen={[draft.agreementId]}
					onChoose={agreementId => set({ agreementId })}
				/>
				<Text style={styles.caption}>{t('screens.standing.agreement-note')}</Text>
				<Text style={styles.caption}>{t('screens.standing.unit-note')}</Text>
			</Card>

			{/*
			 * Story 11 path C step 2, and the reason this screen is not just the
			 * invitation form with the expiry taken out. Whatever goes in here goes
			 * to everyone, so the party is told before they choose, not after.
			 */}
			<Card title={t('screens.standing.disclose')}>
				<Text style={styles.warning}>{t('screens.standing.disclose-public')}</Text>
				<Options
					multiple
					options={held.map(key => ({ value: key, label: fieldLabel(key) }))}
					chosen={draft.disclose}
					onChoose={key =>
						set({
							disclose: draft.disclose.includes(key)
								? draft.disclose.filter(item => item !== key)
								: [...draft.disclose, key],
						})
					}
				/>
				{draft.disclose.length === 0 ? (
					<Text style={styles.caption}>{t('screens.standing.disclose-none')}</Text>
				) : null}
				<Options
					multiple
					options={[{ value: 'yes', label: t('screens.standing.confirm') }]}
					chosen={draft.understood ? ['yes'] : []}
					onChoose={() => set({ understood: !draft.understood })}
				/>
			</Card>

			<View style={styles.actions}>
				<Action label={t('screens.standing.cancel')} onPress={onCancel} secondary />
				<Action
					label={t('screens.standing.publish-now')}
					onPress={draft.understood ? onPublish : undefined}
				/>
			</View>
		</>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	actions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: spacing[2] },
	heading: { ...typography.small, color: tokens.textSecondary, marginTop: spacing[1] },
	link: { ...typography.body, color: tokens.accent },
	body: { ...typography.body, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary },
	warning: { ...typography.caption, color: tokens.negative },
	meta: { ...typography.small, color: tokens.textSecondary },
})
