import { useCallback, useEffect, useState } from 'react'
import {
	ActivityIndicator,
	FlatList,
	Pressable,
	StyleSheet,
	Text,
	useColorScheme,
	View,
} from 'react-native'

import { listTallies } from '../data/tallies'
import type { DataError, TallySummary } from '../data/types'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { dark, light, spacing, type as typography, type Tokens } from '../theme/tokens'
import { formatAmount } from '../util/amount'

type Props = ScreenProps<'TallyList'>

/**
 * TallyList (stories 06, 04) — the launch route once a party exists.
 *
 * Every tally the party holds, each readable without opening it: who it is
 * with, what it counts in, where the balance stands from this party's side,
 * and whether it is waiting on them.
 */
export function TallyList({ navigation }: Props): React.JSX.Element {
	const tokens = useColorScheme() === 'dark' ? dark : light
	const styles = makeStyles(tokens)
	const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
	const [tallies, setTallies] = useState<TallySummary[]>([])
	const [error, setError] = useState<DataError | undefined>()

	const load = useCallback(async () => {
		setState('loading')
		try {
			const result = await listTallies()
			if (result.ok) {
				setTallies(result.value)
				setState('ready')
				return
			}
			setError(result.error)
			setState('failed')
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
		return (
			<View style={[styles.screen, styles.centred]}>
				<ActivityIndicator color={tokens.accent} />
			</View>
		)
	}

	if (state === 'failed') {
		return (
			<View style={[styles.screen, styles.centred]}>
				<View style={styles.banner}>
					<Text style={styles.title}>{t('tally-list.error-title')}</Text>
					<Text style={styles.body}>{error?.message}</Text>
				</View>
				{error?.retryable ? (
					<Pressable style={styles.action} onPress={() => void load()}>
						<Text style={styles.actionText}>{t('tally-list.error-retry')}</Text>
					</Pressable>
				) : null}
			</View>
		)
	}

	if (tallies.length === 0) {
		return (
			<View style={[styles.screen, styles.centred]}>
				<Text style={styles.title}>{t('tally-list.empty-title')}</Text>
				<Text style={[styles.body, styles.centredText]}>{t('tally-list.empty-body')}</Text>
				<Pressable style={styles.action}>
					<Text style={styles.actionText}>{t('tally-list.empty-invite')}</Text>
				</Pressable>
				<Pressable style={styles.secondaryAction}>
					<Text style={styles.secondaryActionText}>{t('tally-list.empty-accept')}</Text>
				</Pressable>
			</View>
		)
	}

	return (
		<View style={styles.screen}>
			<FlatList
				data={tallies}
				keyExtractor={item => item.id}
				renderItem={({ item }) => (
					<TallyRow
						tally={item}
						tokens={tokens}
						onOpen={() =>
							navigation.navigate('TallyView', {
								tallyId: item.id,
								counterpartyName: item.counterparty.name,
							})
						}
					/>
				)}
			/>
		</View>
	)
}

function TallyRow({
	tally,
	tokens,
	onOpen,
}: {
	tally: TallySummary
	tokens: Tokens
	onOpen: () => void
}): React.JSX.Element {
	const styles = makeStyles(tokens)
	const amount = formatAmount(tally.balance, tally.unit)
	const direction = t(`tally-list.${tally.balance.perspective}`)
	const balanceColour =
		tally.balance.perspective === 'owed-to-me'
			? tokens.positive
			: tally.balance.perspective === 'owed-by-me'
				? tokens.negative
				: tokens.textSecondary

	return (
		<Pressable style={styles.row} onPress={onOpen}>
			<View style={styles.rowMain}>
				<Text style={styles.rowName}>{tally.counterparty.name}</Text>
				<Text style={[styles.rowAmount, { color: balanceColour }]}>{amount}</Text>
			</View>
			<View style={styles.rowMeta}>
				<Text style={styles.rowSubtle}>{direction}</Text>
				{tally.waitingOn === 'me' ? (
					<Text style={styles.needsYou}>{t('tally-list.waiting-on-me')}</Text>
				) : tally.waitingOn === 'them' ? (
					<Text style={styles.rowSubtle}>{t('tally-list.waiting-on-them')}</Text>
				) : null}
				{tally.state !== 'Open' ? (
					<Text style={styles.rowSubtle}>{t(`tally-list.state-${tally.state.toLowerCase()}`)}</Text>
				) : null}
			</View>
		</Pressable>
	)
}

function makeStyles(tokens: Tokens) {
	return StyleSheet.create({
		screen: { flex: 1, backgroundColor: tokens.background },
		centred: { alignItems: 'center', justifyContent: 'center', padding: spacing[3] },
		centredText: { textAlign: 'center' },
		heading: { ...typography.title, color: tokens.textPrimary, padding: spacing[3] },
		title: { ...typography.title, color: tokens.textPrimary, marginBottom: spacing[1] },
		body: { ...typography.body, color: tokens.textSecondary, marginBottom: spacing[3] },
		banner: {
			backgroundColor: tokens.bannerError,
			borderRadius: spacing[1],
			padding: spacing[3],
			marginBottom: spacing[3],
		},
		action: {
			backgroundColor: tokens.accent,
			borderRadius: spacing[1],
			paddingVertical: spacing[2],
			paddingHorizontal: spacing[4],
		},
		actionText: { ...typography.body, color: tokens.accentText },
		secondaryAction: { paddingVertical: spacing[2], paddingHorizontal: spacing[4] },
		secondaryActionText: { ...typography.body, color: tokens.accent },
		row: {
			paddingVertical: spacing[3],
			paddingHorizontal: spacing[3],
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: tokens.border,
		},
		rowMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
		rowName: { ...typography.body, color: tokens.textPrimary, flexShrink: 1 },
		rowAmount: { ...typography.body, fontVariant: ['tabular-nums'] },
		rowMeta: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[0] },
		rowSubtle: { ...typography.small, color: tokens.textSecondary },
		needsYou: { ...typography.small, color: tokens.accent },
	})
}
