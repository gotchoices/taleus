import { mockMode } from './config'
import { readParty, type Device } from './party'
import { daysSince, engineAbsent, type Result } from './types'

export type { Device } from './party'

/**
 * A device quiet for this long is worth noticing. The app says how long, and
 * never why: whether it is unplugged, out of signal or gone for good is not
 * something it can know, and guessing on the party's behalf would be worse than
 * silence (story 13 path B).
 */
export const quietAfterDays = 14

export function quietFor(device: Device, now: number = Date.now()): number {
	return daysSince(device.lastActive, now)
}

export function isQuiet(device: Device, now: number = Date.now()): boolean {
	return quietFor(device, now) >= quietAfterDays
}

/** Whether anything of this party's stays on — the whole of story 13 step 3. */
export function hasAlwaysOn(devices: Device[]): boolean {
	return devices.some(device => device.alwaysOn)
}

let written: Device[] | undefined
let retired: string[] = []

export async function listDevices(): Promise<Result<Device[]>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	if (written) {
		return { ok: true, value: written }
	}
	const party = await readParty()
	if (!party.ok) {
		return party
	}
	const devices = (party.value?.devices ?? []).filter(device => !retired.includes(device.id))
	return { ok: true, value: devices }
}

/** Story 13 path E: the list should be meaningful to the party, not to a machine. */
export async function renameDevice(id: string, name: string): Promise<Result<Device[]>> {
	const current = await listDevices()
	if (!current.ok) {
		return current
	}
	written = current.value.map(device => (device.id === id ? { ...device, name } : device))
	return { ok: true, value: written }
}

/**
 * Retiring stops future acts and undoes nothing already done (path C). Two
 * things can prevent it, and they are different failures: the party's last
 * remaining device is refused outright (path D), and a device that cannot be
 * reached right now is a retry, not a refusal.
 */
export async function retireDevice(id: string): Promise<Result<Device[]>> {
	const current = await listDevices()
	if (!current.ok) {
		return current
	}
	if (current.value.length <= 1) {
		return {
			ok: false,
			error: {
				kind: 'last-device',
				message: 'Nothing else of yours could act as you.',
				retryable: false,
			},
		}
	}
	const target = current.value.find(device => device.id === id)
	if (target && target.reachable === false) {
		return {
			ok: false,
			error: {
				kind: 'unreachable',
				message: 'That device is not answering just now.',
				retryable: true,
			},
		}
	}
	written = current.value.filter(device => device.id !== id)
	retired = [...retired, id]
	return { ok: true, value: written }
}

/**
 * Adding one. *How* a party stands up something that stays on is a platform
 * question still settling (story 13 § Open), so this records the decision and
 * not the provisioning.
 */
export async function addDevice(draft: {
	name: string
	kind: Device['kind']
	hostedBy?: string | null
}): Promise<Result<Device[]>> {
	const current = await listDevices()
	if (!current.ok) {
		return current
	}
	const now = new Date().toISOString()
	const alwaysOn = draft.kind === 'node'
	written = [
		...current.value,
		{
			id: `dev:new-${Date.now().toString(36)}`,
			name: draft.name,
			kind: draft.kind,
			lastActive: now,
			alwaysOn,
			contributes: alwaysOn ? ['durability', 'availability'] : ['durability'],
			hostedBy: draft.hostedBy ?? null,
			lastParticipated: alwaysOn ? now : undefined,
		},
	]
	return { ok: true, value: written }
}

export function resetDevices(): void {
	written = undefined
	retired = []
}
