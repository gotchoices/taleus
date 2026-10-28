import { useCallback, useState } from 'react'
import { Text, View } from 'react-native'

import { Action, Card, Failed, FormScroll, Input, Loading, Row } from '../components'
import { listTrusted, trustPublisher, untrustPublisher, type TrustedPublisher } from '../data/publishers'
import { useLoad } from '../hooks/useLoad'
import { errorText, t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'
import { formatCivilDate } from '../util/date'

type Props = ScreenProps<'TrustedPublishers'>

/**
 * TrustedPublishers (story 08) — whose agreements this party trusts.
 *
 * The list is kept for the party as it decides on agreements (most often when accepting one from a
 * publisher it has not met), so nobody has to visit this screen. It is here to see, to add a name a
 * friend recommended, and to remove one. sereus.org makes Taleus and cannot be removed. Removing a
 * publisher changes what the party is told from now on, never a tally already agreed (path E).
 */
export function TrustedPublishers(_props: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { state, value, error, reload } = useLoad(useCallback(() => listTrusted(), []))
	const [name, setName] = useState('')
	const [removing, setRemoving] = useState<string | undefined>()
	const [problem, setProblem] = useState<string | undefined>()

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.publishers.unreadable-title')} error={error} onRetry={reload} />
	}

	const add = async () => {
		setProblem(undefined)
		const result = await trustPublisher(name)
		if (!result.ok) {
			setProblem(errorText(result.error))
			return
		}
		setName('')
		reload()
	}

	const remove = async (domain: string) => {
		const result = await untrustPublisher(domain)
		setRemoving(undefined)
		if (!result.ok) {
			setProblem(errorText(result.error))
			return
		}
		reload()
	}

	return (
		<FormScroll style={styles.screen} contentContainerStyle={styles.content}>
			<Text style={styles.caption}>{t('screens.publishers.intro')}</Text>

			<Card title={t('screens.publishers.list')} footnote={t('screens.publishers.kept-for-you')}>
				{value.map(publisher => (
					<Publisher
						key={publisher.domain}
						publisher={publisher}
						confirming={removing === publisher.domain}
						onRemove={() => setRemoving(publisher.domain)}
						onConfirm={() => void remove(publisher.domain)}
						onCancel={() => setRemoving(undefined)}
					/>
				))}
			</Card>

			<Card title={t('screens.publishers.add')}>
				<Input
					label={t('screens.publishers.add-label')}
					note={t('screens.publishers.add-note')}
					value={name}
					onChangeText={setName}
					autoCapitalize="none"
					autoCorrect={false}
					keyboardType="url"
				/>
				{problem ? <Text style={styles.error}>{problem}</Text> : null}
				<Action label={t('screens.publishers.add-do')} onPress={name.trim() ? () => void add() : undefined} />
			</Card>
		</FormScroll>
	)
}

function Publisher({
	publisher,
	confirming,
	onRemove,
	onConfirm,
	onCancel,
}: {
	publisher: TrustedPublisher
	confirming: boolean
	onRemove(): void
	onConfirm(): void
	onCancel(): void
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<View style={styles.block}>
			<Row
				label={publisher.domain}
				note={
					publisher.builtIn
						? t('screens.publishers.built-in')
						: publisher.since
							? t('screens.publishers.since', { date: formatCivilDate(publisher.since) })
							: undefined
				}
			/>
			{publisher.builtIn ? null : confirming ? (
				<View style={styles.block}>
					<Text style={styles.caption}>{t('screens.publishers.remove-what', { publisher: publisher.domain })}</Text>
					<Action label={t('screens.publishers.remove-confirm')} onPress={onConfirm} />
					<Action label={t('screens.publishers.cancel')} onPress={onCancel} secondary />
				</View>
			) : (
				<Action label={t('screens.publishers.remove')} onPress={onRemove} secondary />
			)}
		</View>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	block: { gap: spacing[1] },
	caption: { ...typography.caption, color: tokens.textSecondary },
	error: { ...typography.caption, color: tokens.negative },
})
