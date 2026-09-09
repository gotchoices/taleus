import { useCallback, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'

import { Action, Amount, Card, Chip, Failed, Loading, Row } from '../components'
import {
	createInvitation,
	listAgreements,
	listInvitations,
	type Agreement,
	type Invitation,
} from '../data/invitations'
import type { Result, Unit } from '../data/types'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, useTokens, spacing, touchTarget, type as typography, type Tokens } from '../theme'
import { formatInstant } from '../util/date'

type Props = ScreenProps<'CreateInvitation'>

interface Page {
	agreements: Agreement[]
	invitations: Invitation[]
}

/** The units a party may denominate a new tally in (story 01 step 5). */
const units: Unit[] = [
	{ denom: 'iso4217:USD', scale: 2, code: 'USD' },
	{ denom: 'CHIP', scale: 3, code: 'CHIP' },
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
	const load = useCallback(async (): Promise<Result<Page>> => {
		const [agreements, invitations] = await Promise.all([listAgreements(), listInvitations()])
		if (!agreements.ok) {
			return agreements
		}
		return {
			ok: true,
			value: { agreements: agreements.value, invitations: invitations.ok ? invitations.value : [] },
		}
	}, [])
	const { state, value, error, reload } = useLoad(load)

	const [note, setNote] = useState('')
	const [limit, setLimit] = useState('500')
	const [notice, setNotice] = useState('14')
	const [unit, setUnit] = useState(units[0])
	const [agreementId, setAgreementId] = useState<string | undefined>()
	const [days, setDays] = useState(1)
	const [made, setMade] = useState<Invitation | undefined>()
	const [failed, setFailed] = useState<string | undefined>()

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.create-invitation.failed-title')} error={error} onRetry={reload} />
	}

	const agreement = agreementId ?? value.agreements.find(a => a.recommended)?.id ?? value.agreements[0]?.id
	const amount = { units: Math.round(Number(limit || '0') * 10 ** unit.scale) }

	const share = async () => {
		setFailed(undefined)
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
				setFailed(result.error.message)
				return
			}
			setMade(result.value)
		} catch (thrown) {
			setFailed(thrown instanceof Error ? thrown.message : String(thrown))
		}
	}

	if (made) {
		return (
			<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
				<Card
					title={t('screens.create-invitation.made-title')}
					footnote={t('screens.create-invitation.made-body')}
				>
					<Text style={styles.token} selectable>
						{made.token}
					</Text>
					<Text style={styles.caption}>
						{t('screens.create-invitation.expires', { date: formatInstant(made.expires) })}
					</Text>
					<Text style={styles.caption}>{t('screens.create-invitation.share-not-built')}</Text>
				</Card>
				<Action label={t('common.retry')} onPress={() => setMade(undefined)} secondary />
			</ScrollView>
		)
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
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
				<Choices
					options={value.agreements.map(a => ({ key: a.id, label: a.title }))}
					selected={agreement}
					onSelect={setAgreementId}
				/>
			</Field>

			<Field label={t('screens.create-invitation.good-for-label')}>
				<Choices
					options={goodFor.map(g => ({ key: String(g.days), label: t(g.labelKey) }))}
					selected={String(days)}
					onSelect={key => setDays(Number(key))}
				/>
			</Field>

			{failed ? <Text style={styles.error}>{failed}</Text> : null}
			<Action label={t('screens.create-invitation.share')} onPress={() => void share()} />

			{value.invitations.length > 0 ? (
				<Card title={t('screens.create-invitation.outstanding-title')}>
					{value.invitations.map(invitation => (
						<Row
							key={invitation.token}
							label={invitation.note ?? invitation.token}
							note={t('screens.create-invitation.expires', {
								date: formatInstant(invitation.expires),
							})}
							value={
								invitation.state === 'expired' ? (
									<Chip label={t('screens.create-invitation.state-expired')} />
								) : (
									<Amount value={invitation.creditLimit} unit={invitation.unit} />
								)
							}
						/>
					))}
				</Card>
			) : null}
		</ScrollView>
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
	token: { ...typography.body, color: tokens.textPrimary, fontVariant: ['tabular-nums' as const] },
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
