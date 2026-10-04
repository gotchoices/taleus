/**
 * The areas that live on this device and never on a tally: settings, notifications, rates and
 * devices -- plus the profile, which is device state that reaches counterparties only as the
 * certificate this party publishes, and the standing invitation, which needs Sereus support first.
 *
 * All of it starts empty and neutral. Engine mode must never borrow the mock's fixtures here:
 * they hold sample people.
 */
import type { Device, DevicesModel } from '../devices.js'
import type { NotificationsModel } from '../notifications.js'
import type { Delivery, Field, Profile, ProfileModel } from '../profile.js'
import type { RatesModel } from '../rates.js'
import type { HeldUnit, SettingsModel } from '../settings.js'
import type { StandingModel } from '../standing.js'
import type { Session } from './session.js'
import { failed, nameOf, ok, stateOf, unsupported } from './translate.js'
import { standingUnsupported } from './formation.js'

export interface LocalAreas {
	settings: SettingsModel
	notifications: NotificationsModel
	rates: RatesModel
	devices: DevicesModel
	profile: ProfileModel
	standing: StandingModel
	displayUnit(): string
}

export function localAreas(session: Session): LocalAreas {
	const { local } = session
	const thisDevice = (): Device => ({
		id: 'this-device',
		name: local.deviceName,
		kind: 'phone',
		lastActive: session.now().toISOString(),
		thisDevice: true,
		contributes: ['durability', 'availability'],
	})

	/** The units this party holds: whatever its tallies are in. */
	async function unitsHeld(): Promise<HeldUnit[]> {
		const seen = new Map<string, HeldUnit>()
		for (const { view } of await session.views()) {
			const unit = session.unitOf(view)
			seen.set(unit.denom, { ...unit, priced: local.rates.some(r => r.denom === unit.denom) })
		}
		return [...seen.values()]
	}

	const readSettings = async () => ok({ ...local.settings, unitsHeld: await unitsHeld() })
	const readRates = async () =>
		ok({
			against: local.settings.displayUnit,
			rates: [...local.rates],
			unpriced: (await unitsHeld()).filter(u => !u.priced),
			conversions: [],
		})

	async function readProfile() {
		const held: Field[] = Object.entries(session.certificate()).map(([key, value]) => ({ key, value }))
		const disclosures: Profile['disclosures'] = []
		for (const { view } of await session.views()) {
			if (view.counterparty.sid === '') continue
			const fields = (certificate: unknown): Field[] =>
				Object.entries((certificate ?? {}) as Record<string, unknown>)
					.filter(([, v]) => typeof v === 'string')
					.map(([key, value]) => ({ key, value: value as string }))
			disclosures.push({
				tallyId: view.ref.id,
				counterparty: { sid: view.counterparty.sid, name: nameOf(view.counterparty.sid, view.counterparty.certificate) },
				state: stateOf(view.state),
				reachable: true,
				sent: fields(view.me.certificate),
				received: fields(view.counterparty.certificate),
				requests: [],
			})
		}
		return ok({ held, disclosures })
	}

	/** Publish this party's whole certificate on one tally -- the core's unit of disclosure. */
	async function publishTo(tallyId: string): Promise<boolean> {
		const tally = await session.tally(tallyId)
		if (!tally) return false
		return (await tally.publishCertificate(session.certificate())).ok
	}

	return {
		displayUnit: () => local.settings.displayUnit,

		settings: {
			readSettings,
			async writeSettings(change) {
				const { unitsHeld: _ignored, ...rest } = change
				Object.assign(local.settings, rest)
				session.changed()
				return readSettings()
			},
		},

		notifications: {
			async readNotifications() {
				return ok({ ...local.notifications })
			},
			async setDelivery(id, delivery) {
				local.notifications.classes = local.notifications.classes.map(c => (c.id === id && !c.fixed ? { ...c, delivery } : c))
				session.changed()
				return ok({ ...local.notifications })
			},
			async setNotifications(change) {
				Object.assign(local.notifications, change)
				session.changed()
				return ok({ ...local.notifications })
			},
		},

		rates: {
			readRates,
			async setRate(rate) {
				const at = local.rates.findIndex(r => r.denom === rate.denom)
				if (at >= 0) local.rates[at] = rate
				else local.rates.push(rate)
				session.changed()
				return readRates()
			},
			async clearRate(denom) {
				const at = local.rates.findIndex(r => r.denom === denom)
				if (at >= 0) local.rates.splice(at, 1)
				session.changed()
				return readRates()
			},
		},

		devices: {
			async listDevices() {
				return ok([thisDevice()])
			},
			async renameDevice(id, name) {
				if (id !== thisDevice().id) return failed<Device[]>('not-found', `no device ${id}`)
				local.deviceName = name
				session.changed()
				return ok([thisDevice()])
			},
			async retireDevice() {
				return unsupported('Retiring a device', 'feat-device-and-recovery-surface')
			},
			async addDevice() {
				return unsupported('Adding a device', 'feat-device-and-recovery-surface')
			},
		},

		profile: {
			readProfile,
			async setField(key, value) {
				// Held on this device. It reaches a counterparty only when the party authorizes it.
				if (key === 'name') local.displayName = value
				else local.disclosed[key] = value
				session.changed()
				return readProfile()
			},
			async authorizeCorrection(_key, tallyIds) {
				const deliveries: Delivery[] = []
				for (const tallyId of tallyIds) {
					const tally = await session.tally(tallyId)
					const view = tally ? await tally.read() : undefined
					deliveries.push({
						tallyId,
						name: view ? nameOf(view.counterparty.sid, view.counterparty.certificate) : tallyId,
						delivered: await publishTo(tallyId),
					})
				}
				return ok(deliveries)
			},
			async discloseMore(tallyId) {
				// The core publishes a certificate whole, so "more" means the full current set.
				// Choosing which fields each counterparty sees is `feat-disclosure-selection`.
				if (!(await publishTo(tallyId))) return failed<Profile>('not-found', `could not publish to ${tallyId}`)
				return readProfile()
			},
			async askFor() {
				return unsupported('Asking a counterparty for details', 'feat-disclosure-selection')
			},
			async answerRequest() {
				return unsupported('Answering a request for details', 'feat-disclosure-selection')
			},
		},

		standing: {
			async readStanding() {
				return ok(null)
			},
			publishStanding: async () => standingUnsupported(),
			withdrawStanding: async () => standingUnsupported(),
		},
	}
}
