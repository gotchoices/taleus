import { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'

import { Empty, Failed, Loading } from '../components/Screen'
import { readPosition, type PositionSummary } from '../data/position'
import type { DataError } from '../data/types'
import { t } from '../i18n'
import { dark, light, spacing, type as typography, type Tokens } from '../theme/tokens'
import { formatAmount, unitLabel } from '../util/amount'

/**
 * Position (story 40) — how a party is doing overall.
 *
 * Three rules the story is emphatic about, and this screen enforces: owed and
 * owing are shown separately rather than only netted; per-unit figures are the
 * real ones and the cross-unit figure is an estimate that names what it leaves
 * out; and credit available is never mixed into what the party holds.
 */
export function Position(): React.JSX.Element {
	const tokens = useColorScheme() === 'dark' ? dark : light
	const styles = makeStyles(tokens)
	const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
	const [position, setPosition] = useState<PositionSummary | undefined>()
	const [error, setError] = useState<DataError | undefined>()

	const load = useCallback(async () => {
		setState('loading')
		try {
		const result = await readPosition()
		if (!result.ok) {
			setState('failed')
			return
		}
		setPosition(result.value)
		setState('ready')
		} catch (thrown) {
			setError({
				kind: 'unexpected',
				message: thrown instanceof Error ? thrown.message : String(thrown),
				retryable: true,
			})
			setState('failed')
		}
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	if (state === 'loading') {
		return <Loading tokens={tokens} />
	}
	if (state === 'failed' || !position) {
		return <Failed
				tokens={tokens}
				title={t('position.unreadable-title')}
				message={error?.message}
				retryable={error?.retryable ?? true}
				onRetry={() => void load()}
			/>
	}
	if (position.perUnit.length === 0) {
		return <Empty tokens={tokens} title={t('position.empty-title')} body={t('position.empty-body')} />
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			{position.perUnit.map(unit => {
				const u = { denom: unit.denom, scale: unit.scale, label: unit.label }
				return (
					<View key={unit.denom} style={styles.card}>
						<Text style={styles.cardTitle}>{unitLabel(unit.denom, unit.label)}</Text>
						<View style={styles.row}>
							<Text style={styles.body}>{t('position.owed-to-me')}</Text>
							<Text style={[styles.amount, { color: tokens.positive }]}>
								{formatAmount(unit.owedToMe, u)}
							</Text>
						</View>
						<View style={styles.row}>
							<Text style={styles.body}>{t('position.owed-by-me')}</Text>
							<Text style={[styles.amount, { color: tokens.negative }]}>
								{formatAmount(unit.owedByMe, u)}
							</Text>
						</View>
					</View>
				)
			})}

			{position.estimate ? (
				<View style={styles.card}>
					<Text style={styles.cardTitle}>{t('position.estimate-title')}</Text>
					<View style={styles.row}>
						<Text style={styles.body}>{t('position.estimate-net')}</Text>
						<Text style={styles.amount}>
							{formatAmount(position.estimate.net, {
								denom: position.estimate.unit,
								scale: position.estimate.scale,
							})}
						</Text>
					</View>
					<Text style={styles.meta}>{t('position.estimate-note')}</Text>
					{position.estimate.excluded.length > 0 ? (
						<Text style={styles.meta}>
							{t('position.estimate-excludes', {
								units: position.estimate.excluded
									.map(item => item.label ?? item.denom)
									.join(', '),
							})}
						</Text>
					) : null}
				</View>
			) : null}

			{position.spendingPower ? (
				<View style={styles.card}>
					<Text style={styles.cardTitle}>{t('position.spending-title')}</Text>
					<View style={styles.row}>
						<Text style={styles.body}>{t('position.spending-held')}</Text>
						<Text style={styles.amount}>
							{formatAmount(position.spendingPower.heldByOthers, {
								denom: position.spendingPower.heldByOthers.denom ?? position.displayUnit,
								scale: position.spendingPower.heldByOthers.scale ?? 2,
							})}
						</Text>
					</View>
					<View style={styles.row}>
						<Text style={styles.body}>{t('position.spending-credit')}</Text>
						<Text style={styles.amount}>
							{formatAmount(position.spendingPower.creditExtendedToMe, {
								denom: position.spendingPower.creditExtendedToMe.denom ?? position.displayUnit,
								scale: position.spendingPower.creditExtendedToMe.scale ?? 2,
							})}
						</Text>
					</View>
					<Text style={styles.meta}>{t('position.spending-note')}</Text>
				</View>
			) : null}
		</ScrollView>
	)
}

function makeStyles(tokens: Tokens) {
	return StyleSheet.create({
		screen: { flex: 1, backgroundColor: tokens.background },
		content: { padding: spacing[3], gap: spacing[3] },
		card: {
			backgroundColor: tokens.surfaceAlt,
			borderRadius: spacing[1],
			padding: spacing[3],
			gap: spacing[1],
		},
		cardTitle: { ...typography.small, color: tokens.textSecondary },
		row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[2] },
		body: { ...typography.body, color: tokens.textPrimary },
		amount: { ...typography.body, color: tokens.textPrimary, fontVariant: ['tabular-nums'] },
		meta: { ...typography.small, color: tokens.textSecondary },
	})
}
