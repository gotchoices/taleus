/** devices: shapes and policy shared by every implementation of the model. */
import { type Result, daysSince } from './types.js'
import type { Device } from './party.js'
export type { Device } from './party.js'

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

/** What a screen can read and do about devices. Both the mock and the engine implement it. */
export interface DevicesModel {
	listDevices(): Promise<Result<Device[]>>
	/** Story 13 path E: the list should be meaningful to the party, not to a machine. */
	renameDevice(id: string, name: string): Promise<Result<Device[]>>
	/**
	 * Retiring stops future acts and undoes nothing already done (path C). Two
	 * things can prevent it, and they are different failures: the party's last
	 * remaining device is refused outright (path D), and a device that cannot be
	 * reached right now is a retry, not a refusal.
	 */
	retireDevice(id: string): Promise<Result<Device[]>>
	/**
	 * Adding one. *How* a party stands up something that stays on is a platform
	 * question still settling (story 13 § Open), so this records the decision and
	 * not the provisioning.
	 */
	addDevice(draft: {
		name: string
		kind: Device['kind']
		hostedBy?: string | null
	}): Promise<Result<Device[]>>
}
