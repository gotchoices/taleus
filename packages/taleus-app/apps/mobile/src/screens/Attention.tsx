import { useCallback, useEffect, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native'

import { Empty, Failed, Loading } from '../components/Screen'
import { listAttention, type AttentionItem } from '../data/attention'
import type { DataError } from '../data/types'
import { t } from '../i18n'
import { dark, light, spacing, type as typography, type Tokens } from '../theme/tokens'
import { formatAmount } from '../util/amount'

/**
 * Attention (story 23) — everything waiting on this party, across every tally.
 *
 * Two absences are deliberate. Automated settling never appears: it was
 * authorized in advance and needs nothing. And items waiting on the *other*
 * party appear plainly marked, so a party knows about them without being asked
 * for anything.
 */
export function Attention(): React.JSX.Element {
	const tokens = useColorScheme() === 'dark' ? dark : light
	const styles = makeStyles(tokens)
	const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
	const [items, setItems] = useState<AttentionItem[]>([])
	const [error, setError] = useState<DataError | undefined>()

	const load = useCallback(async () => {
		setState('loading')
		try {
		const result = await listAttention()
		if (!result.ok) {
			setState('failed')
			return
		}
		setItems(result.value)
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
	if (state === 'failed') {
		return <Failed
				tokens={tokens}
				title={t('attention.unreadable-title')}
				message={error?.message}
				retryable={error?.retryable ?? true}
				onRetry={() => void load()}
			/>
	}

	const mine = items.filter(item => item.waitingOn !== 'them')
	const theirs = items.filter(item => item.waitingOn === 'them')

	if (mine.length === 0 && theirs.length === 0) {
		return <Empty tokens={tokens} title={t('attention.empty-title')} body={t('attention.empty-body')} />
	}

	return (
		<FlatList
			style={styles.screen}
			data={mine}
			keyExtractor={item => item.id}
			ListHeaderComponent={
				mine.length === 0 ? <Text style={styles.sectionNote}>{t('attention.none-for-you')}</Text> : null
			}
			renderItem={({ item }) => <Item item={item} tokens={tokens} needsYou />}
			ListFooterComponent={
				theirs.length > 0 ? (
					<View style={styles.footer}>
						<Text style={styles.sectionNote}>{t('attention.waiting-on-others')}</Text>
						{theirs.map(item => (
							<Item key={item.id} item={item} tokens={tokens} />
						))}
					</View>
				) : null
			}
		/>
	)
}

function Item({
	item,
	tokens,
	needsYou,
}: {
	item: AttentionItem
	tokens: Tokens
	needsYou?: boolean
}): React.JSX.Element {
	const styles = makeStyles(tokens)
	return (
		<Pressable style={styles.item}>
			<View style={styles.itemTop}>
				<Text style={styles.body}>{item.counterparty.name}</Text>
				{item.amount ? (
					<Text style={styles.amount}>
						{formatAmount(item.amount, {
							denom: item.amount.denom ?? 'iso4217:USD',
							scale: item.amount.scale ?? 2,
						})}
					</Text>
				) : null}
			</View>
			<Text style={styles.meta}>{item.summary}</Text>
			<Text style={needsYou ? styles.needsYou : styles.meta}>
				{needsYou ? t(`attention.kind-${item.kind}`) : t('attention.waiting-on-them')}
			</Text>
		</Pressable>
	)
}

function makeStyles(tokens: Tokens) {
	return StyleSheet.create({
		screen: { flex: 1, backgroundColor: tokens.background },
		item: {
			padding: spacing[3],
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: tokens.border,
			gap: spacing[0],
		},
		itemTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[2] },
		body: { ...typography.body, color: tokens.textPrimary, flexShrink: 1 },
		amount: { ...typography.body, color: tokens.textPrimary, fontVariant: ['tabular-nums'] },
		meta: { ...typography.small, color: tokens.textSecondary },
		needsYou: { ...typography.small, color: tokens.accent },
		sectionNote: { ...typography.small, color: tokens.textSecondary, padding: spacing[3] },
		footer: { paddingTop: spacing[2] },
	})
}
