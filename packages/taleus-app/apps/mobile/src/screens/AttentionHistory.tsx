import { useCallback } from 'react'
import { FlatList, Text, View } from 'react-native'

import { Action, Amount, Chip, Empty, Failed, Loading, OpenableRow } from '../components'
import { bringBack, listPast, type PastItem } from '../data/attention'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import { unitOf } from '../data/types'
import { isTallyRoute, type ScreenProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'
import { formatInstant } from '../util/date'

type Props = ScreenProps<'AttentionHistory'>

/**
 * AttentionHistory (story 23 path E) — what has been through the list, and what
 * became of each one.
 *
 * The story's sentence is the whole design: *nothing quietly disappears; an item
 * leaving the list is an event with an outcome, not an absence*. So every entry
 * names its outcome, and the two that are not answers are marked as such — one
 * that ran out unanswered is not one that was handled, and one the party set
 * aside is still unanswered with nothing having reached the other side.
 */
export function AttentionHistory({ navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { state, value, error, reload } = useLoad(useCallback(() => listPast(), []))

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed') {
		return (
			<Failed
				title={t('screens.attention-history.unreadable-title')}
				error={error}
				onRetry={reload}
			/>
		)
	}

	const past = value ?? []
	if (past.length === 0) {
		return (
			<Empty
				title={t('screens.attention-history.empty-title')}
				body={t('screens.attention-history.empty-body')}
			/>
		)
	}

	const open = (item: PastItem) => {
		if (item.route === 'RequestView' && item.requestId) {
			navigation.navigate('Tallies', {
				screen: 'RequestView',
				params: { requestId: item.requestId },
			})
			return
		}
		navigation.navigate('Tallies', {
			screen: isTallyRoute(item.route) ? item.route : 'TallyView',
			params: { tallyId: item.tallyId },
		})
	}

	return (
		<FlatList
			style={styles.screen}
			data={past}
			keyExtractor={item => item.id}
			ListHeaderComponent={
				<Text style={styles.sectionNote}>{t('screens.attention-history.intro')}</Text>
			}
			renderItem={({ item }) => (
				<PastRow
					item={item}
					onOpen={() => open(item)}
					onBringBack={() => void bringBack(item.id).then(reload)}
				/>
			)}
		/>
	)
}

function PastRow({
	item,
	onOpen,
	onBringBack,
}: {
	item: PastItem
	onOpen: () => void
	onBringBack: () => void
}): React.JSX.Element {
	const styles = useStyles(make)
	const name = item.counterparty.name
	const summary = t(`screens.attention.summary-${item.kind}`, { name })
	const outcome = t(`screens.attention-history.outcome-${item.outcome}`, { name })

	return (
		<View>
			<OpenableRow onPress={onOpen} accessibilityLabel={`${summary} — ${outcome}`}>
				<View style={styles.top}>
					<Text style={styles.body}>{summary}</Text>
					{item.amount ? <Amount value={item.amount} unit={unitOf(item.amount)} /> : null}
				</View>
				<View style={styles.meta}>
					{/* An outcome, always. This is the row's reason for existing — and
					    none of them is urgent: everything here has stopped asking, and a
					    chip that shouts would be the screen contradicting itself. */}
					<Chip label={outcome} />
					<Text style={styles.small}>
						{t('screens.attention-history.arrived-resolved', {
							arrived: formatInstant(item.arrived),
							resolved: formatInstant(item.resolved),
						})}
					</Text>
				</View>
				{/* The two that are not answers say so. */}
				{item.outcome === 'lapsed' ? (
					<Text style={styles.small}>{t('screens.attention-history.lapsed-note')}</Text>
				) : null}
				{item.outcome === 'set-aside' ? (
					<Text style={styles.small}>
						{t('screens.attention-history.set-aside-note', { name })}
					</Text>
				) : null}
			</OpenableRow>
			{/* Path F step 4: back whenever the party likes. */}
			{item.outcome === 'set-aside' ? (
				<View style={styles.actions}>
					<Action label={t('screens.attention-history.bring-back')} onPress={onBringBack} secondary />
				</View>
			) : null}
		</View>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	top: {
		flexDirection: 'row' as const,
		justifyContent: 'space-between' as const,
		alignItems: 'center' as const,
		gap: spacing[2],
	},
	meta: {
		flexDirection: 'row' as const,
		alignItems: 'center' as const,
		gap: spacing[1],
		flexWrap: 'wrap' as const,
		marginTop: spacing[0],
	},
	actions: {
		flexDirection: 'row' as const,
		justifyContent: 'flex-end' as const,
		paddingHorizontal: spacing[2],
	},
	body: { ...typography.body, color: tokens.textPrimary, flexShrink: 1 },
	small: { ...typography.small, color: tokens.textSecondary },
	sectionNote: { ...typography.caption, color: tokens.textSecondary, padding: spacing[3] },
})
