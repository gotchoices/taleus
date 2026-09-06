import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { Empty, Failed, Loading } from '../components/Screen'
import { readTally, type TallyDetail } from '../data/tally'
import { listRequests, type PaymentRequest } from '../data/requests'
import type { DataError } from '../data/types'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { dark, light, spacing, type as typography, type Tokens } from '../theme/tokens'
import { formatAmount } from '../util/amount'
import { formatDate } from '../util/date'

type Props = ScreenProps<'TallyView'>

/**
 * TallyView (stories 04, 07) — what a tally is, from this party's side.
 *
 * Terms are shown in both directions and labelled by who extended them, so
 * "what I allow" and "what they allow" are never ambiguous. Room to spend is
 * kept visibly separate from value held.
 */
export function TallyView({ route, navigation }: Props): React.JSX.Element {
	const tokens = useColorScheme() === 'dark' ? dark : light
	const styles = makeStyles(tokens)
	const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
	const [tally, setTally] = useState<TallyDetail | undefined>()
	const [requests, setRequests] = useState<PaymentRequest[]>([])
	const [error, setError] = useState<DataError | undefined>()

	const load = useCallback(async () => {
		setState('loading')
		try {
		const result = await readTally(route.params.tallyId)
		if (!result.ok) {
			setError(result.error)
			setState('failed')
			return
		}
		setTally(result.value)
		const asked = await listRequests(route.params.tallyId)
		setRequests(asked.ok ? asked.value : [])
		setState('ready')
		} catch (thrown) {
			setError({
				kind: 'unexpected',
				message: thrown instanceof Error ? thrown.message : String(thrown),
				retryable: true,
			})
			setState('failed')
		}
	}, [route.params.tallyId])

	useEffect(() => {
		void load()
	}, [load])

	if (state === 'loading') {
		return <Loading tokens={tokens} />
	}

	if (state === 'failed' || !tally) {
		return (
			<Failed
				tokens={tokens}
				title={t('tally-view.unreadable-title')}
				message={error?.message}
				retryable={error?.retryable}
				onRetry={() => void load()}
			/>
		)
	}

	const settled = tally.balance.perspective === 'level'

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<View style={styles.balanceBlock}>
				<Text style={styles.balance}>{formatAmount(tally.balance, tally.unit)}</Text>
				<Text style={styles.balanceLabel}>
					{t(`tally-view.${tally.balance.perspective}`, { name: tally.counterparty.name })}
				</Text>
				{settled ? <Text style={styles.settledNote}>{t('tally-view.settled-note')}</Text> : null}
			</View>

			{tally.state !== 'Open' ? (
				<View style={styles.stateBanner}>
					<Text style={styles.stateText}>{t(`tally-view.state-${tally.state.toLowerCase()}`)}</Text>
				</View>
			) : null}

			<Section title={t('tally-view.terms-title')} tokens={tokens}>
				<Row
					tokens={tokens}
					label={t('tally-view.i-extend')}
					value={formatAmount(tally.terms.mine.creditLimit, tally.unit)}
					note={t('tally-view.notice-days', { days: tally.terms.mine.noticeDays })}
				/>
				<Row
					tokens={tokens}
					label={t('tally-view.they-extend', { name: tally.counterparty.name })}
					value={formatAmount(tally.terms.theirs.creditLimit, tally.unit)}
					note={t('tally-view.notice-days', { days: tally.terms.theirs.noticeDays })}
				/>
				<Row
					tokens={tokens}
					label={t('tally-view.room-to-spend')}
					value={formatAmount(tally.roomToSpend, tally.unit)}
					note={t('tally-view.room-note')}
				/>
				<Text style={styles.meta}>
					{t('tally-view.terms-effective', { date: formatDate(tally.terms.mine.effective) })}
				</Text>
			</Section>

			<Section title={t('tally-view.agreement-title')} tokens={tokens}>
				<Text style={styles.body}>{tally.agreement.title}</Text>
				<Text style={styles.meta}>
					{t('tally-view.agreement-meta', {
						publisher: tally.agreement.publisher,
						language: tally.agreement.language,
					})}
				</Text>
			</Section>

			<Section title={t('tally-view.who-title')} tokens={tokens}>
				{Object.entries(tally.counterparty.disclosed ?? {}).map(([field, value]) => (
					<Row key={field} tokens={tokens} label={t(`disclosure.${field}`)} value={value} />
				))}
				<Text style={styles.meta}>{t('tally-view.disclosure-note')}</Text>
			</Section>

			{requests.length > 0 ? (
				<Section title={t('tally-view.requests-title')} tokens={tokens}>
					{requests.map(request => (
						<Row
							key={request.id}
							tokens={tokens}
							label={request.memo ?? t('tally-view.request-generic')}
							value={formatAmount(request.stillAsked, tally.unit)}
							note={t('tally-view.request-outstanding', { days: request.outstandingDays })}
						/>
					))}
					<Text style={styles.meta}>{t('tally-view.requests-note')}</Text>
				</Section>
			) : null}

			<Pressable
				style={styles.action}
				onPress={() => navigation.navigate('TallyHistory', { tallyId: tally.id })}
			>
				<Text style={styles.actionText}>{t('tally-view.see-history')}</Text>
			</Pressable>
		</ScrollView>
	)
}

function Section({
	title,
	tokens,
	children,
}: {
	title: string
	tokens: Tokens
	children: React.ReactNode
}): React.JSX.Element {
	const styles = makeStyles(tokens)
	return (
		<View style={styles.section}>
			<Text style={styles.sectionTitle}>{title}</Text>
			{children}
		</View>
	)
}

function Row({
	tokens,
	label,
	value,
	note,
}: {
	tokens: Tokens
	label: string
	value: string
	note?: string
}): React.JSX.Element {
	const styles = makeStyles(tokens)
	return (
		<View style={styles.row}>
			<View style={styles.rowLabel}>
				<Text style={styles.body}>{label}</Text>
				{note ? <Text style={styles.meta}>{note}</Text> : null}
			</View>
			<Text style={styles.rowValue}>{value}</Text>
		</View>
	)
}

function makeStyles(tokens: Tokens) {
	return StyleSheet.create({
		screen: { flex: 1, backgroundColor: tokens.background },
		content: { padding: spacing[3], gap: spacing[3] },
		balanceBlock: { alignItems: 'center', paddingVertical: spacing[3] },
		balance: { fontSize: 34, fontWeight: '600', color: tokens.textPrimary, fontVariant: ['tabular-nums'] },
		balanceLabel: { ...typography.body, color: tokens.textSecondary, marginTop: spacing[0] },
		settledNote: { ...typography.small, color: tokens.textSecondary, marginTop: spacing[1] },
		stateBanner: { backgroundColor: tokens.surfaceAlt, borderRadius: spacing[1], padding: spacing[2] },
		stateText: { ...typography.small, color: tokens.textPrimary },
		section: {
			backgroundColor: tokens.surfaceAlt,
			borderRadius: spacing[1],
			padding: spacing[3],
			gap: spacing[1],
		},
		sectionTitle: { ...typography.small, color: tokens.textSecondary, marginBottom: spacing[0] },
		row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[2] },
		rowLabel: { flexShrink: 1 },
		rowValue: { ...typography.body, color: tokens.textPrimary, fontVariant: ['tabular-nums'] },
		body: { ...typography.body, color: tokens.textPrimary },
		meta: { ...typography.small, color: tokens.textSecondary },
		action: {
			backgroundColor: tokens.accent,
			borderRadius: spacing[1],
			paddingVertical: spacing[2],
			alignItems: 'center',
		},
		actionText: { ...typography.body, color: tokens.accentText },
	})
}
