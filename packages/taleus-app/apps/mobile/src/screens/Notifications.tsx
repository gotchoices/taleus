import { useCallback } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { Card, Chip, Failed, Loading, Options, Segmented } from '../components'
import {
	readNotifications,
	setDelivery,
	setNotifications,
	type Delivery,
	type LockScreenDetail,
	type NoticeClass,
	type NotificationSettings,
} from '../data/notifications'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'

/**
 * Notifications (story 43) — what interrupts, and what merely informs.
 *
 * The app's job here is narrow and the screen says so: it classifies honestly,
 * and the phone decides what to do about a class. Quiet hours are deliberately
 * absent — the party already has them where they expect them, and a second set
 * would fight the first.
 *
 * Two things are stated rather than offered, because they are not the party's to
 * choose. Value moving under authority they already gave never notifies: there
 * is nothing for them to do. And what a lock screen reveals is shown as a sample
 * before the choice, not described after it.
 */
export function Notifications(): React.JSX.Element {
	const styles = useStyles(make)
	const { state, value, error, reload } = useLoad(useCallback(() => readNotifications(), []))

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.notifications.unreadable-title')} error={error} onRetry={reload} />
	}

	const refused = value.permission === 'denied'

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Card>
				<Text style={styles.body}>{t('screens.notifications.intro')}</Text>
				<Text style={styles.caption}>{t('screens.notifications.phone-decides')}</Text>
			</Card>

			{/* Path D: told once what it costs, and not badgered. */}
			{refused ? (
				<Card title={t('screens.notifications.refused')}>
					<Text style={styles.caption}>{t('screens.notifications.refused-cost')}</Text>
					<Text style={styles.caption}>{t('screens.notifications.refused-waiting')}</Text>
					<Text style={styles.meta}>{t('screens.notifications.refused-where')}</Text>
				</Card>
			) : null}

			<Card title={t('screens.notifications.classes')}>
				{value.classes.map(item => (
					<NoticeClassRow key={item.id} item={item} onChoose={delivery => void change(item, delivery)} />
				))}
			</Card>

			<Card>
				<Text style={styles.caption}>{t('screens.notifications.opening')}</Text>
				{/* Path E, stated as behaviour rather than offered as a toggle: the
				    party should not have to ask for one interruption instead of twelve. */}
				<Text style={styles.caption}>{t('screens.notifications.together')}</Text>
			</Card>

			<LockScreen
				detail={value.lockScreenDetail}
				onChoose={detail => void setNotifications({ lockScreenDetail: detail }).then(reload)}
			/>

			<Participation
				settings={value}
				onChoose={on => void setNotifications({ backgroundParticipation: on }).then(reload)}
			/>
		</ScrollView>
	)

	async function change(item: NoticeClass, delivery: Delivery): Promise<void> {
		if (item.fixed) {
			return
		}
		await setDelivery(item.id, delivery)
		reload()
	}
}

function NoticeClassRow({
	item,
	onChoose,
}: {
	item: NoticeClass
	onChoose(delivery: Delivery): void
}): React.JSX.Element {
	const styles = useStyles(make)
	const label = t(`screens.notifications.class-${item.id}`)
	const note = t(`screens.notifications.class-${item.id}-note`)

	// Path A. Shown as a row rather than hidden, so the party can see that the
	// app is not quietly deciding its own events deserve them.
	if (item.fixed) {
		return (
			<View style={styles.block}>
				<View style={styles.fixedTop}>
					<Text style={styles.body}>{label}</Text>
					<Chip label={t('screens.notifications.delivery-silent')} />
				</View>
				<Text style={styles.meta}>{note}</Text>
			</View>
		)
	}

	return (
		<View style={styles.block}>
			<Text style={styles.body}>{label}</Text>
			<Text style={styles.meta}>{note}</Text>
			{/* A row, not a column: the same three-way choice repeats for every kind
			    of notice, and stacking them turns a small table into four screens of
			    scrolling — losing the comparison the table was for. */}
			<Segmented<Delivery>
				label={label}
				segments={[
					{
						value: 'interrupt',
						label: t('screens.notifications.delivery-interrupt-short'),
						spoken: t('screens.notifications.delivery-interrupt'),
					},
					{
						value: 'inform',
						label: t('screens.notifications.delivery-inform-short'),
						spoken: t('screens.notifications.delivery-inform'),
					},
					{
						value: 'silent',
						label: t('screens.notifications.delivery-silent-short'),
						spoken: t('screens.notifications.delivery-silent'),
					},
				]}
				chosen={item.delivery}
				onChoose={onChoose}
			/>
		</View>
	)
}

/**
 * Path C. The party may choose to show more, "having been shown what that
 * reveals" — so each option carries the line it would actually put in front of
 * whoever is standing there.
 */
function LockScreen({
	detail,
	onChoose,
}: {
	detail: LockScreenDetail
	onChoose(detail: LockScreenDetail): void
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<Card
			title={t('screens.notifications.lock-screen')}
			footnote={t('screens.notifications.lock-screen-note')}
		>
			<Options<LockScreenDetail>
				options={[
					{
						value: 'minimal',
						label: t('screens.notifications.lock-minimal'),
						note: t('screens.notifications.lock-minimal-sample'),
					},
					{
						value: 'full',
						label: t('screens.notifications.lock-full'),
						note: t('screens.notifications.lock-full-sample'),
					},
				]}
				chosen={[detail]}
				onChoose={onChoose}
			/>
			{detail === 'full' ? (
				<Text style={styles.warning}>{t('screens.notifications.lock-full-warning')}</Text>
			) : null}
		</Card>
	)
}

/**
 * Path B. Being roused to take part is not a message and shows the party
 * nothing; it is best effort and the screen says so; and a party who wants it
 * dependable is pointed at a machine of theirs rather than at another setting
 * here — which this app cannot supply and should not pretend to.
 */
function Participation({
	settings,
	onChoose,
}: {
	settings: NotificationSettings
	onChoose(on: boolean): void
}): React.JSX.Element {
	const styles = useStyles(make)
	return (
		<Card title={t('screens.notifications.participation')}>
			<Text style={styles.caption}>{t('screens.notifications.participation-what')}</Text>
			<Options<'on' | 'off'>
				options={[
					{ value: 'on', label: t('screens.notifications.participation-on') },
					{ value: 'off', label: t('screens.notifications.participation-off') },
				]}
				chosen={[settings.backgroundParticipation ? 'on' : 'off']}
				onChoose={answer => onChoose(answer === 'on')}
			/>
			{settings.backgroundParticipation ? (
				<Text style={styles.caption}>{t('screens.notifications.participation-best-effort')}</Text>
			) : (
				<Text style={styles.caption}>{t('screens.notifications.participation-declined')}</Text>
			)}
			{settings.hasAlwaysOnDevice ? (
				<Text style={styles.caption}>{t('screens.notifications.always-on-have')}</Text>
			) : (
				<>
					<Text style={styles.warning}>{t('screens.notifications.always-on-none')}</Text>
					<Text style={styles.meta}>{t('screens.notifications.always-on-where')}</Text>
				</>
			)}
		</Card>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	block: { gap: spacing[0], paddingVertical: spacing[1] },
	fixedTop: {
		flexDirection: 'row' as const,
		alignItems: 'center' as const,
		justifyContent: 'space-between' as const,
		gap: spacing[2],
	},
	body: { ...typography.body, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary },
	warning: { ...typography.caption, color: tokens.negative },
	meta: { ...typography.small, color: tokens.textSecondary },
})
