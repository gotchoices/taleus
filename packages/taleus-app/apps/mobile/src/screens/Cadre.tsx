import { useCallback } from 'react'
import { ScrollView, Text } from 'react-native'

import { Action, Card, Failed, Loading, Row } from '../components'
import { listDevices, type Device } from '../data/devices'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import type { ScreenProps } from '../navigation/routes'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'

type Props = ScreenProps<'Cadre'>

/**
 * Cadre (stories 14, 51) — where this party's records live.
 *
 * The story's demand is an honest split, and the screen is built around it. A
 * party's *tallies* are the less fragile part, because the counterparty holds
 * them too — but that safety is borrowed, and saying so is the point: a partner
 * who vanishes or keeps careless records leaves the party with nothing of their
 * own to point at. A party's *own* records — rates, preferences, their view of
 * their affairs — have no copy anywhere else, because none of it is any
 * counterparty's business.
 *
 * Everything here is stated in terms of what the party would lose, never in
 * terms of nodes and replication, and a party running only a phone is told once
 * rather than nagged.
 */
export function Cadre({ navigation }: Props): React.JSX.Element {
	const styles = useStyles(make)
	const { state, value, error, reload } = useLoad(useCallback(() => listDevices(), []))

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.cadre.unreadable-title')} error={error} onRetry={reload} />
	}

	const machines = value
	const alone = machines.length <= 1

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Card title={t('screens.cadre.today')}>
				{alone ? (
					<Text style={styles.body}>{t('screens.cadre.today-one')}</Text>
				) : (
					machines.map(machine => (
						<Row key={machine.id} label={machine.name} note={contribution(machine)} />
					))
				)}
			</Card>

			{/* Step 3. The good news and its condition, in that order — the condition
			    is the part a party will not work out for themselves. */}
			<Card title={t('screens.cadre.tallies-title')}>
				<Text style={styles.body}>{t('screens.cadre.tallies-body')}</Text>
				<Text style={styles.caption}>{t('screens.cadre.tallies-borrowed')}</Text>
			</Card>

			{/* Step 4, and path A: what they would lose, in their own terms. */}
			<Card title={t('screens.cadre.private-title')}>
				<Text style={styles.body}>{t('screens.cadre.private-body')}</Text>
				{alone ? <Text style={styles.warning}>{t('screens.cadre.private-one')}</Text> : null}
			</Card>

			<Card title={t('screens.cadre.add')}>
				<Text style={styles.caption}>{t('screens.cadre.add-what')}</Text>
				{/* Story 14 § Open. What a node is and how one is stood up is a
				    platform matter; this screen is where the party decides they want
				    one, and `Devices` is where machines are actually added and retired. */}
				<Text style={styles.caption}>{t('screens.cadre.add-how')}</Text>
				{/* Step 7: told what they would be giving up, before they go and do it. */}
				{machines.length === 2 ? (
					<Text style={styles.warning}>{t('screens.cadre.remove-last-warning')}</Text>
				) : null}
				{alone ? null : <Text style={styles.caption}>{t('screens.cadre.remove-note')}</Text>}
				<Action
					label={t('screens.cadre.machines')}
					onPress={() => navigation.navigate('Devices')}
					secondary
				/>
			</Card>

			{/* Path B: a different decision from adding one of your own, and the app
			    does not blur them. Stated, with nothing to press — the offer comes
			    from a friend, not from here. */}
			<Card title={t('screens.cadre.hosted-title')}>
				<Text style={styles.caption}>{t('screens.cadre.hosted-body')}</Text>
			</Card>

			{/* Path D, path E, and story 51: nothing to arrange, and reachability is
			    not something the party maintains by hand. */}
			<Card title={t('screens.cadre.nothing-to-arrange')}>
				<Text style={styles.caption}>{t('screens.cadre.nothing-to-arrange-body')}</Text>
				<Text style={styles.caption}>{t('screens.cadre.contact-separate')}</Text>
			</Card>
		</ScrollView>
	)
}

/** What one machine is actually doing for the party — never both by default. */
function contribution(machine: Device): string {
	const durability = machine.contributes.includes('durability')
	const availability = machine.contributes.includes('availability')
	if (durability && availability) {
		return t('screens.cadre.contributes-both')
	}
	if (availability) {
		return t('screens.cadre.contributes-availability')
	}
	return t('screens.cadre.contributes-durability')
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	body: { ...typography.body, color: tokens.textPrimary },
	caption: { ...typography.caption, color: tokens.textSecondary },
	warning: { ...typography.caption, color: tokens.negative },
})
