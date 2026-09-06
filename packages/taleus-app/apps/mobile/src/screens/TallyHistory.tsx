import { useCallback, useEffect, useState } from 'react'
import { FlatList, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { Empty, Failed, Loading } from '../components/Screen'
import { listEntries, type Entry } from '../data/entries'
import { listRequests, type PaymentRequest } from '../data/requests'
import { readTally, type TallyDetail } from '../data/tally'
import type { DataError } from '../data/types'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { dark, light, spacing, type as typography, type Tokens } from '../theme/tokens'
import { formatAmount } from '../util/amount'
import { formatDate } from '../util/date'

type Props = ScreenProps<'TallyHistory'>

/**
 * TallyHistory (story 24) — what has actually happened, and what is still being
 * asked.
 *
 * Every entry carries the balance that resulted, so today's figure can be
 * followed back rather than trusted. Outstanding requests sit *alongside* the
 * entries, never in them: what a party owes is what has been signed; what the
 * other party is asking is their statement of what they think is owed.
 */
export function TallyHistory({ route }: Props): React.JSX.Element {
	const tokens = useColorScheme() === 'dark' ? dark : light
	const styles = makeStyles(tokens)
	const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
	const [entries, setEntries] = useState<Entry[]>([])
	const [requests, setRequests] = useState<PaymentRequest[]>([])
	const [tally, setTally] = useState<TallyDetail | undefined>()
	const [error, setError] = useState<DataError | undefined>()

	const load = useCallback(async () => {
		setState('loading')
		try {
		const detail = await readTally(route.params.tallyId)
		if (!detail.ok) {
			setState('failed')
			return
		}
		setTally(detail.value)
		const [history, asked] = await Promise.all([
			listEntries(route.params.tallyId),
			listRequests(route.params.tallyId),
		])
		setEntries(history.ok ? history.value : [])
		setRequests(asked.ok ? asked.value.filter(r => r.state !== 'answered') : [])
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
		return <Failed
				tokens={tokens}
				title={t('tally-history.unreadable-title')}
				message={error?.message}
				retryable={error?.retryable ?? true}
				onRetry={() => void load()}
			/>
	}
	if (entries.length === 0 && requests.length === 0) {
		return <Empty tokens={tokens} title={t('tally-history.empty-title')} body={t('tally-history.empty-body')} />
	}

	return (
		<FlatList
			style={styles.screen}
			data={entries}
			keyExtractor={entry => entry.id}
			ListHeaderComponent={
				requests.length > 0 ? (
					<View style={styles.asked}>
						<Text style={styles.askedTitle}>{t('tally-history.still-asked')}</Text>
						{requests.map(request => (
							<View key={request.id} style={styles.askedRow}>
								<View style={styles.grow}>
									<Text style={styles.body}>{request.memo ?? t('tally-history.request-generic')}</Text>
									<Text style={styles.meta}>
										{request.applied.units > 0
											? t('tally-history.applied', {
													applied: formatAmount(request.applied, tally.unit),
													days: request.outstandingDays,
												})
											: t('tally-history.outstanding-days', { days: request.outstandingDays })}
									</Text>
								</View>
								<Text style={styles.amount}>{formatAmount(request.stillAsked, tally.unit)}</Text>
							</View>
						))}
						<Text style={styles.meta}>{t('tally-history.asked-note')}</Text>
					</View>
				) : null
			}
			renderItem={({ item }) => (
				<View style={styles.entry}>
					<View style={styles.entryTop}>
						<Text style={styles.body}>{item.memo ?? t('tally-history.entry-generic')}</Text>
						<Text
							style={[
								styles.amount,
								{ color: item.amount.units < 0 ? tokens.negative : tokens.positive },
							]}
						>
							{formatAmount(item.amount, tally.unit)}
						</Text>
					</View>
					<View style={styles.entryMeta}>
						<Text style={styles.meta}>{formatDate(item.date)}</Text>
						<Text style={styles.meta}>
							{item.kind === 'routed' ? t('tally-history.routed') : t(`tally-history.by-${item.issuer}`)}
						</Text>
						<Text style={styles.meta}>
							{t('tally-history.balance-after', {
								balance: formatAmount(item.balanceAfter, tally.unit),
							})}
						</Text>
					</View>
				</View>
			)}
		/>
	)
}

function makeStyles(tokens: Tokens) {
	return StyleSheet.create({
		screen: { flex: 1, backgroundColor: tokens.background },
		asked: {
			backgroundColor: tokens.surfaceAlt,
			padding: spacing[3],
			gap: spacing[1],
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: tokens.border,
		},
		askedTitle: { ...typography.small, color: tokens.textSecondary },
		askedRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[2] },
		grow: { flexShrink: 1 },
		entry: {
			padding: spacing[3],
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: tokens.border,
			gap: spacing[0],
		},
		entryTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[2] },
		entryMeta: { flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' },
		body: { ...typography.body, color: tokens.textPrimary, flexShrink: 1 },
		amount: { ...typography.body, color: tokens.textPrimary, fontVariant: ['tabular-nums'] },
		meta: { ...typography.small, color: tokens.textSecondary },
	})
}
