import { useCallback, useState } from 'react'
import { Pressable, Share, Text, TextInput, useWindowDimensions, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'

import { Action, Amount, Card, Chip, Failed, FormScroll, Input as LabelledInput, Loading, OpenableRow, PublisherNote, Row } from '../components'
import {
	DEFAULT_NOTICE_DAYS,
	createInvitation,
	importAgreement,
	listAgreements,
	listInvitations,
	type ImportedAgreement,
	type Invitation,
} from '../data/invitations'
import { buildInviteLink } from '../data/inviteLink'
import { trustAgreement, trustPublisher } from '../data/publishers'
import type { Unit } from '../data/types'
import { useLoad } from '../hooks/useLoad'
import { errorText, t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, useTokens, spacing, touchTarget, type as typography, type Tokens } from '../theme'
import { formatInstant } from '../util/date'

type Props = ScreenProps<'CreateInvitation'>


/** The units a party may denominate a new tally in (story 01 step 5). */
const units: Unit[] = [
	{ denom: 'iso4217:USD', divisor: 100, code: 'USD' },
	{ denom: 'CHIP', divisor: 1000, code: 'CHIP' },
]

const goodFor = [
	{ days: 1, labelKey: 'screens.create-invitation.good-for-day' },
	{ days: 7, labelKey: 'screens.create-invitation.good-for-week' },
	{ days: 30, labelKey: 'screens.create-invitation.good-for-month' },
]

/**
 * CreateInvitation (story 01) — terms, and nobody's name.
 *
 * The shape of this screen comes from step 1: the inviter is not asked who it is
 * for. There is no recipient field anywhere, because whoever accepts becomes the
 * other party and their identity comes only from what they disclose. The private
 * note exists so a party can tell their outstanding invitations apart; it is a
 * memo, never a claim.
 */
export function CreateInvitation({ navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { state, value: agreements, error, reload } = useLoad(useCallback(() => listAgreements(), []))
	// Apart from the form: knowing whether each invitation was taken up means reading its tally,
	// seconds apiece on a phone, and nothing on the form waits on it.
	const outstanding = useLoad(useCallback(() => listInvitations(), []))

	const [note, setNote] = useState('')
	const [limit, setLimit] = useState('500')
	const [notice, setNotice] = useState(String(DEFAULT_NOTICE_DAYS))
	const [unit, setUnit] = useState(units[0])
	const [agreementId, setAgreementId] = useState<string | undefined>()
	const [days, setDays] = useState(1)
	const [made, setMade] = useState<Invitation | undefined>()
	const [making, setMaking] = useState(false)
	const [failed, setFailed] = useState<string | undefined>()
	const [link, setLink] = useState('')
	const [found, setFound] = useState<ImportedAgreement | undefined>()
	const [linkProblem, setLinkProblem] = useState<string | undefined>()

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !agreements) {
		return <Failed title={t('screens.create-invitation.failed-title')} error={error} onRetry={reload} />
	}
	const invitations: Invitation[] = outstanding.value ?? []

	const agreement = agreementId ?? agreements.find(a => a.recommended)?.id ?? agreements[0]?.id
	const chosen = agreements.find(a => a.id === agreement)

	// Story 01 path F: an agreement from a link -- what its code carries.
	const look = async () => {
		setLinkProblem(undefined)
		setFound(undefined)
		const result = await importAgreement(link.trim())
		if (!result.ok) {
			setLinkProblem(errorText(result.error))
			return
		}
		setFound(result.value)
	}
	const take = async (how: 'agreement' | 'publisher') => {
		if (!found) return
		if (how === 'agreement') await trustAgreement(found.id)
		else await trustPublisher(found.publisher)
		setAgreementId(found.id)
		setFound(undefined)
		setLink('')
		reload()
	}
	const amount = { units: Math.round(Number(limit || '0') * unit.divisor) }

	const share = async () => {
		setFailed(undefined)
		setMaking(true)
		try {
			const result = await createInvitation({
				note: note.trim() || undefined,
				unit,
				creditLimit: amount,
				noticeDays: Number(notice || '0'),
				agreementId: agreement,
				goodForDays: days,
			})
			if (!result.ok) {
				setFailed(errorText(result.error))
				return
			}
			setMade(result.value)
			outstanding.reload()
		} catch (thrown) {
			setFailed(thrown instanceof Error ? thrown.message : String(thrown))
		} finally {
			setMaking(false)
		}
	}

	if (made) {
		return <ShareInvitation invitation={made} onDone={() => setMade(undefined)} />
	}

	return (
		<FormScroll style={styles.screen} contentContainerStyle={styles.content}>
			<Text style={styles.caption}>{t('screens.create-invitation.no-recipient')}</Text>

			<Field label={t('screens.create-invitation.note-label')} note={t('screens.create-invitation.note-note')}>
				<Input value={note} onChangeText={setNote} placeholder={t('screens.create-invitation.note-placeholder')} />
			</Field>

			<Card footnote={t('screens.create-invitation.yours-only')}>
				<Field label={t('screens.create-invitation.limit-label')}>
					<Input value={limit} onChangeText={setLimit} keyboardType="numeric" />
				</Field>
				<Field label={t('screens.create-invitation.notice-label')}>
					<Input value={notice} onChangeText={setNotice} keyboardType="numeric" />
				</Field>
			</Card>

			<Field
				label={t('screens.create-invitation.unit-label')}
				note={t('screens.create-invitation.unit-permanent')}
			>
				<Choices
					options={units.map(u => ({ key: u.denom, label: u.code ?? u.denom }))}
					selected={unit.denom}
					onSelect={key => setUnit(units.find(u => u.denom === key) ?? units[0])}
				/>
			</Field>

			<Field
				label={t('screens.create-invitation.agreement-label')}
				note={t('screens.create-invitation.agreement-note')}
			>
				{agreements.length > 0 ? (
					<Choices
						options={agreements.map(a => ({ key: a.id, label: a.title }))}
						selected={agreement}
						onSelect={setAgreementId}
					/>
				) : (
					<Text style={styles.caption}>{t('screens.create-invitation.agreement-none')}</Text>
				)}
				{chosen ? (
					<Card>
						<PublisherNote agreement={chosen} />
						<OpenableRow
							onPress={() => navigation.navigate('Agreement', { agreementId: chosen.id })}
							accessibilityLabel={t('screens.create-invitation.agreement-read')}
						>
							<Text style={styles.body}>{t('screens.create-invitation.agreement-read')}</Text>
						</OpenableRow>
					</Card>
				) : null}
			</Field>

			<Card title={t('screens.create-invitation.other-title')} footnote={t('screens.create-invitation.other-note')}>
				<LabelledInput
					label={t('screens.create-invitation.other-label')}
					value={link}
					onChangeText={setLink}
					autoCapitalize="none"
					autoCorrect={false}
					keyboardType="url"
				/>
				{linkProblem ? <Text style={styles.error}>{linkProblem}</Text> : null}
				<Action label={t('screens.create-invitation.other-look')} onPress={link.trim() ? () => void look() : undefined} secondary />
				{found ? (
					<View style={styles.field}>
						<Text style={styles.body}>{found.title}</Text>
						<PublisherNote agreement={found} />
						<OpenableRow
							onPress={() => navigation.navigate('Agreement', { agreementId: found.id })}
							accessibilityLabel={t('screens.create-invitation.agreement-read')}
						>
							<Text style={styles.body}>{t('screens.create-invitation.agreement-read')}</Text>
						</OpenableRow>
						<Action label={t('screens.create-invitation.other-use')} onPress={() => void take('agreement')} />
						{found.standing?.publisherConfirms === 'yes' && found.standing.trust === 'none' ? (
							<Action
								label={t('screens.create-invitation.other-trust', { publisher: found.publisher })}
								onPress={() => void take('publisher')}
								secondary
							/>
						) : null}
						<Action label={t('screens.create-invitation.other-leave')} onPress={() => setFound(undefined)} secondary />
					</View>
				) : null}
			</Card>

			<Field label={t('screens.create-invitation.good-for-label')}>
				<Choices
					options={goodFor.map(g => ({ key: String(g.days), label: t(g.labelKey) }))}
					selected={String(days)}
					onSelect={key => setDays(Number(key))}
				/>
			</Field>

			{failed ? <Text style={styles.error}>{failed}</Text> : null}
			{/* Making one founds the tally's strand: seconds on a desktop, a minute or more on a
			    slow phone. Said, so a slow step does not read as a dead button. */}
			<Action
				label={making ? t('screens.create-invitation.making') : t('screens.create-invitation.share')}
				onPress={making ? undefined : () => void share()}
			/>
			{making ? <Text style={styles.caption}>{t('screens.create-invitation.making-note')}</Text> : null}

			{outstanding.state === 'loading' ? (
				<Card title={t('screens.create-invitation.outstanding-title')}>
					<Text style={styles.caption}>{t('screens.create-invitation.outstanding-loading')}</Text>
				</Card>
			) : null}
			{invitations.length > 0 ? (
				<Card title={t('screens.create-invitation.outstanding-title')}>
					{invitations.map(invitation =>
						invitation.state === 'outstanding' ? (
							// Still good: it can be shared again (story 01).
							<OpenableRow
								key={invitation.token}
								onPress={() => setMade(invitation)}
								accessibilityLabel={t('screens.create-invitation.share-again', {
									note: invitation.note ?? t('screens.create-invitation.unnoted'),
								})}
							>
								<Row
									label={invitation.note ?? t('screens.create-invitation.unnoted')}
									note={t('screens.create-invitation.expires', { date: formatInstant(invitation.expires) })}
									value={<Amount value={invitation.creditLimit} unit={invitation.unit} />}
								/>
							</OpenableRow>
						) : (
							<Row
								key={invitation.token}
								label={invitation.note ?? t('screens.create-invitation.unnoted')}
								note={t('screens.create-invitation.expires', { date: formatInstant(invitation.expires) })}
								value={
									<Chip
										label={
											invitation.state === 'expired'
												? t('screens.create-invitation.state-expired')
												: t(`screens.create-invitation.state-${invitation.state}`)
										}
									/>
								}
							/>
						),
					)}
				</Card>
			) : null}
		</FormScroll>
	)
}

/**
 * The invitation, ready to hand over (story 01 step 8, path D). In person, the other party points
 * their phone's own camera at the code: the link opens Taleus if they have it, and a page offering
 * it if they do not. Apart, the link goes by whatever the phone sends things with.
 */
function ShareInvitation({ invitation, onDone }: { invitation: Invitation; onDone(): void }): React.JSX.Element {
	const styles = useStyles(make)
	const { width } = useWindowDimensions()
	const link = buildInviteLink(invitation.token)
	const send = async () => {
		await Share.share({ message: link, url: link, title: t('screens.create-invitation.send-title') })
	}
	return (
		<FormScroll style={styles.screen} contentContainerStyle={styles.content}>
			<Card title={t('screens.create-invitation.made-title')} footnote={t('screens.create-invitation.made-body')}>
				{invitation.note ? <Text style={styles.body}>{invitation.note}</Text> : null}
				<Text style={styles.caption}>{t('screens.create-invitation.expires', { date: formatInstant(invitation.expires) })}</Text>
			</Card>

			<Card title={t('screens.create-invitation.in-person')} footnote={t('screens.create-invitation.in-person-note')}>
				{/* Dark on white whatever the theme, with a quiet zone: what a camera needs. */}
				<View style={styles.code} accessibilityLabel={t('screens.create-invitation.code-label')}>
					<QRCode value={link} size={Math.min(width - spacing[3] * 6, 360)} ecl="L" quietZone={12} color="#000000" backgroundColor="#ffffff" />
				</View>
			</Card>

			<Card title={t('screens.create-invitation.apart')} footnote={t('screens.create-invitation.apart-note')}>
				<Action label={t('screens.create-invitation.send')} onPress={() => void send()} />
				<Text style={styles.link} selectable numberOfLines={3}>
					{link}
				</Text>
			</Card>

			<Action label={t('screens.create-invitation.done')} onPress={onDone} secondary />
		</FormScroll>
	)
}

function Field({
	label,
	note,
	children,
}: {
	label: string
	note?: string
	children: React.ReactNode
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<View style={styles.field}>
			<Text style={styles.body}>{label}</Text>
			{children}
			{note ? <Text style={styles.caption}>{note}</Text> : null}
		</View>
	)
}

function Input(props: React.ComponentProps<typeof TextInput>): React.JSX.Element {
	const styles = useStyles(make)
	const tokens = useTokens()
	return (
		<TextInput
			accessibilityLabel={props.placeholder}
			placeholderTextColor={tokens.textSecondary}
			autoCorrect={false}
			{...props}
			style={styles.input}
		/>
	)
}

/** One of a short, fixed set — a unit, an agreement, a duration. */
function Choices({
	options,
	selected,
	onSelect,
}: {
	options: { key: string; label: string }[]
	selected?: string
	onSelect(key: string): void
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<View style={styles.choices}>
			{options.map(option => {
				const active = option.key === selected
				return (
					<Pressable
						key={option.key}
						accessibilityRole="radio"
						accessibilityState={{ selected: active }}
						accessibilityLabel={option.label}
						android_ripple={{ borderless: false }}
						onPress={() => onSelect(option.key)}
						style={({ pressed }) => [
							active ? styles.choiceOn : styles.choice,
							pressed ? styles.pressed : null,
						]}
					>
						<Text style={active ? styles.choiceOnText : styles.choiceText}>{option.label}</Text>
					</Pressable>
				)
			})}
		</View>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	field: { gap: spacing[1] },
	body: { ...typography.body, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary },
	error: { ...typography.caption, color: tokens.negative },
	link: { ...typography.small, color: tokens.textSecondary },
	code: { alignItems: 'center' as const, backgroundColor: '#ffffff', borderRadius: spacing[1], padding: spacing[2] },
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
	choices: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing[1] },
	choice: {
		borderWidth: 1,
		borderColor: tokens.border,
		borderRadius: spacing[1],
		minHeight: touchTarget,
		justifyContent: 'center' as const,
		paddingHorizontal: spacing[3],
	},
	choiceOn: {
		borderWidth: 1,
		borderColor: tokens.accent,
		backgroundColor: tokens.accent,
		borderRadius: spacing[1],
		minHeight: touchTarget,
		justifyContent: 'center' as const,
		paddingHorizontal: spacing[3],
	},
	choiceText: { ...typography.body, color: tokens.textPrimary },
	choiceOnText: { ...typography.body, color: tokens.accentText },
	pressed: { opacity: 0.6 },
})
