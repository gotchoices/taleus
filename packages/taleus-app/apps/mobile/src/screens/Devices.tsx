import { useCallback, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { Action, Card, Chip, Failed, Input, Loading, Options } from '../components'
import {
	addDevice,
	hasAlwaysOn,
	isQuiet,
	listDevices,
	quietFor,
	renameDevice,
	retireDevice,
	type Device,
} from '../data/devices'
import type { DataError } from '../data/types'
import { useLoad } from '../hooks/useLoad'
import { t } from '../i18n'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'
import { formatInstant } from '../util/date'

/**
 * Devices (story 13) — what can act as this party.
 *
 * The screen exists to teach one thing the party has no way to discover on
 * their own: settling with people they are not directly connected to happens by
 * itself, but only while something of theirs is awake. A phone asleep in a
 * pocket is not that. So the consequence is stated in the party's own terms —
 * trades that could have settled overnight waited for them — rather than as an
 * error, because having only a phone is not a defect.
 *
 * Retiring is the other thing here, and it is described accurately: it stops
 * future acts and undoes nothing already done.
 */
export function Devices(): React.JSX.Element {
	const styles = useStyles(make)
	const { state, value, error, reload } = useLoad(useCallback(() => listDevices(), []))
	const [renaming, setRenaming] = useState<{ id: string; name: string } | undefined>()
	const [adding, setAdding] = useState<{ name: string; kind: Device['kind'] } | undefined>()
	const [failure, setFailure] = useState<DataError | undefined>()

	if (state === 'loading') {
		return <Loading />
	}
	if (state === 'failed' || !value) {
		return <Failed title={t('screens.devices.unreadable-title')} error={error} onRetry={reload} />
	}

	const devices = value
	const alwaysOn = devices.find(device => device.alwaysOn)
	const last = devices.length <= 1

	const retire = async (id: string) => {
		setFailure(undefined)
		const result = await retireDevice(id)
		if (!result.ok) {
			setFailure(result.error)
			return
		}
		reload()
	}

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<Card>
				<Text style={styles.body}>{t('screens.devices.intro')}</Text>
			</Card>

			{devices.map(device =>
				renaming?.id === device.id ? (
					<Card key={device.id}>
						<Input
							label={t('screens.devices.rename')}
							value={renaming.name}
							onChangeText={name => setRenaming({ id: device.id, name })}
							autoFocus
							note={t('screens.devices.rename-note')}
						/>
						<View style={styles.actions}>
							<Action
								label={t('screens.devices.cancel')}
								onPress={() => setRenaming(undefined)}
								secondary
							/>
							<Action
								label={t('screens.devices.save')}
								onPress={
									renaming.name.trim()
										? () =>
												void renameDevice(device.id, renaming.name.trim()).then(() => {
													setRenaming(undefined)
													reload()
												})
										: undefined
								}
							/>
						</View>
					</Card>
				) : (
					<DeviceCard
						key={device.id}
						device={device}
						last={last}
						failure={failure?.kind === 'unreachable' ? failure : undefined}
						onRename={() => setRenaming({ id: device.id, name: device.name })}
						onRetire={() => void retire(device.id)}
					/>
				),
			)}

			{/* Path C, once. Told before it is needed, because the moment it is
			    needed is a phone somebody else is holding. */}
			<Card title={t('screens.devices.retire')}>
				<Text style={styles.caption}>{t('screens.devices.retire-what')}</Text>
				<Text style={styles.caption}>{t('screens.devices.retire-anywhere')}</Text>
			</Card>

			{/* Steps 3-5, and path A. The consequence, not a complaint. */}
			<Card title={t('screens.devices.settling-title')}>
				<Text style={styles.body}>{t('screens.devices.settling-body')}</Text>
				{alwaysOn ? (
					<Text style={styles.caption}>
						{t('screens.devices.settling-fixed', { name: alwaysOn.name })}
					</Text>
				) : (
					<>
						<Text style={styles.caption}>{t('screens.devices.settling-cost')}</Text>
						<Text style={styles.caption}>{t('screens.devices.settling-fix')}</Text>
					</>
				)}
			</Card>

			{adding ? (
				<Card title={t('screens.devices.add')}>
					<Input
						label={t('screens.devices.add-name')}
						value={adding.name}
						onChangeText={name => setAdding({ ...adding, name })}
						autoFocus
					/>
					<Text style={styles.heading}>{t('screens.devices.add-kind')}</Text>
					<Options<Device['kind']>
						options={[
							{ value: 'node', label: t('screens.devices.add-node') },
							{ value: 'phone', label: t('screens.devices.add-handheld') },
						]}
						chosen={[adding.kind]}
						onChoose={kind => setAdding({ ...adding, kind })}
					/>
					{/* Story 13 § Open: what an always-available device is, and how a
					    party stands one up, is still a platform question. The decision
					    is recorded; the provisioning is not invented. */}
					<Text style={styles.caption}>{t('screens.devices.add-how')}</Text>
					<View style={styles.actions}>
						<Action
							label={t('screens.devices.cancel')}
							onPress={() => setAdding(undefined)}
							secondary
						/>
						<Action
							label={t('screens.devices.add-do')}
							onPress={
								adding.name.trim()
									? () =>
											void addDevice({ name: adding.name.trim(), kind: adding.kind }).then(() => {
												setAdding(undefined)
												reload()
											})
									: undefined
							}
						/>
					</View>
				</Card>
			) : (
				<Action
					label={t('screens.devices.add')}
					onPress={() => setAdding({ name: '', kind: hasAlwaysOn(devices) ? 'phone' : 'node' })}
					secondary
				/>
			)}
		</ScrollView>
	)
}

function DeviceCard({
	device,
	last,
	failure,
	onRename,
	onRetire,
}: {
	device: Device
	last: boolean
	failure?: DataError
	onRename(): void
	onRetire(): void
}): React.JSX.Element {
	const styles = useStyles(make)
	const quiet = isQuiet(device)

	return (
		<Card>
			<View style={styles.top}>
				<Text style={styles.body}>{device.name}</Text>
				{device.thisDevice ? <Chip label={t('screens.devices.this-device')} /> : null}
			</View>
			<Text style={styles.meta}>{t(`screens.devices.kind-${device.kind}`)}</Text>

			{/* Step 2, and path B: how long, never why. */}
			<Text style={quiet ? styles.warning : styles.meta}>
				{quiet
					? t('screens.devices.quiet-for', {
							count: quietFor(device),
							days: quietFor(device),
						})
					: device.thisDevice || device.alwaysOn
						? t('screens.devices.active-now')
						: t('screens.devices.active-when', { date: formatInstant(device.lastActive) })}
			</Text>
			{quiet ? <Text style={styles.caption}>{t('screens.devices.quiet-note')}</Text> : null}

			{device.alwaysOn ? (
				<>
					<Text style={styles.meta}>
						{device.hostedBy
							? t('screens.devices.hosted-by', { who: device.hostedBy })
							: t('screens.devices.hosted-self')}
					</Text>
					{/* Step 7: the party can see it working. */}
					{device.lastParticipated ? (
						<Text style={styles.meta}>
							{t('screens.devices.took-part', { date: formatInstant(device.lastParticipated) })}
						</Text>
					) : null}
				</>
			) : null}

			{failure ? <Text style={styles.warning}>{t('screens.devices.retire-unreachable')}</Text> : null}

			{/* Path D is about this device, so it belongs on this card. What retiring
			    *does* is the same sentence for every device, and saying it three times
			    is noise — it sits once, under the list. */}
			{last ? <Text style={styles.caption}>{t('screens.devices.retire-last')}</Text> : null}

			<View style={styles.actions}>
				<Action label={t('screens.devices.rename')} onPress={onRename} secondary />
				<Action
					label={t('screens.devices.retire')}
					onPress={last ? undefined : onRetire}
					secondary
				/>
			</View>
		</Card>
	)
}

const make = (tokens: Tokens) => ({
	screen: { flex: 1, backgroundColor: tokens.background },
	content: { padding: spacing[3], gap: spacing[3] },
	top: {
		flexDirection: 'row' as const,
		alignItems: 'center' as const,
		justifyContent: 'space-between' as const,
		gap: spacing[2],
	},
	actions: {
		flexDirection: 'row' as const,
		justifyContent: 'flex-end' as const,
		gap: spacing[2],
		marginTop: spacing[1],
	},
	heading: { ...typography.small, color: tokens.textSecondary, marginTop: spacing[1] },
	body: { ...typography.body, color: tokens.textPrimary, flexShrink: 1 },
	caption: { ...typography.caption, color: tokens.textSecondary },
	warning: { ...typography.caption, color: tokens.negative },
	meta: { ...typography.small, color: tokens.textSecondary },
})
