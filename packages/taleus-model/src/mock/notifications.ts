import { fixture } from '../fixtures.js'
import { getVariant } from '../variant.js'
import { readParty } from './party.js'
import type { Result } from '../types.js'
import type { Delivery, NoticeClassId, NotificationSettings } from '../notifications.js'

let written: Partial<NotificationSettings> = {}

export async function readNotifications(): Promise<Result<NotificationSettings>> {
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
	written = { ...written, ...change }
	return readNotifications()
}

export function resetNotifications(): void {
	written = {}
}

function fixtureFor(variant: string): { notifications: Omit<NotificationSettings, 'hasAlwaysOnDevice'> } {
	switch (variant) {
		case 'error':
			return fixture('notifications.error') as {
				notifications: Omit<NotificationSettings, 'hasAlwaysOnDevice'>
			}
		default:
			return fixture('notifications.happy') as {
				notifications: Omit<NotificationSettings, 'hasAlwaysOnDevice'>
			}
	}
}
