import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import { readParty } from './party'
import { engineAbsent, type Result } from './types'

/**
 * What the app does with an event — and nothing more than that.
 *
 * Whether an interruption actually rings, vibrates or waits for quiet hours is
 * the phone's decision, and the party already has that where they expect it
 * (story 43 step 6). What the app owes them is an honest classification, so the
 * policy they already set can act on something real.
 */
export type Delivery = 'interrupt' | 'inform' | 'silent'

/**
 * The four kinds of thing that happen to a party, in the order they care.
 *
 * `signature` needs them to sign something; `asked` is somebody's claim on
 * them; `arrived` is a courtesy; `automatic` is value moving under authority
 * they already gave.
 */
export type NoticeClassId = 'signature' | 'asked' | 'arrived' | 'automatic'

export interface NoticeClass {
	id: NoticeClassId
	delivery: Delivery
	/**
	 * Not the party's to change. Only `automatic` is: they authorised it, there
	 * is nothing for them to do, and notifying would be the app deciding its own
	 * events are important (path A).
	 */
	fixed?: boolean
}

/** What shows when the phone lights up on a table between other people. */
export type LockScreenDetail = 'minimal' | 'full'

export interface NotificationSettings {
	permission: 'granted' | 'denied' | 'unasked'
	classes: NoticeClass[]
	lockScreenDetail: LockScreenDetail
	/**
	 * Whether the phone may be roused to take part in settling. Not a message:
	 * there is nothing to read or dismiss (path B step 2).
	 */
	backgroundParticipation: boolean
	/**
	 * Whether anything of the party's stays on. Read from their devices, not
	 * stored here — path B's answer is a machine, not a setting.
	 */
	hasAlwaysOnDevice: boolean
}

let written: Partial<NotificationSettings> = {}

export async function readNotifications(): Promise<Result<NotificationSettings>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	const party = await readParty()
	const fixture = fixtureFor(getVariant()).notifications
	return {
		ok: true,
		value: {
			...fixture,
			hasAlwaysOnDevice:
				party.ok && party.value ? party.value.devices.some(device => device.alwaysOn) : false,
			...written,
		},
	}
}

export async function setDelivery(
	id: NoticeClassId,
	delivery: Delivery,
): Promise<Result<NotificationSettings>> {
	const current = await readNotifications()
	if (!current.ok) {
		return current
	}
	const target = current.value.classes.find(item => item.id === id)
	if (target?.fixed) {
		return {
			ok: false,
			error: {
				kind: 'fixed',
				message: 'This one never notifies.',
				retryable: false,
			},
		}
	}
	written = {
		...written,
		classes: current.value.classes.map(item => (item.id === id ? { ...item, delivery } : item)),
	}
	return readNotifications()
}

export async function setNotifications(
	change: Partial<Pick<NotificationSettings, 'lockScreenDetail' | 'backgroundParticipation'>>,
): Promise<Result<NotificationSettings>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	written = { ...written, ...change }
	return readNotifications()
}

export function resetNotifications(): void {
	written = {}
}

function fixtureFor(variant: string): { notifications: Omit<NotificationSettings, 'hasAlwaysOnDevice'> } {
	switch (variant) {
		case 'error':
			return require('../../mock/data/notifications.error.json') as {
				notifications: Omit<NotificationSettings, 'hasAlwaysOnDevice'>
			}
		default:
			return require('../../mock/data/notifications.happy.json') as {
				notifications: Omit<NotificationSettings, 'hasAlwaysOnDevice'>
			}
	}
}
