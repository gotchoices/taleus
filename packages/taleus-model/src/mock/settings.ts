import { fixture } from '../fixtures.js'
import { getVariant } from '../variant.js'
import type { Result } from '../types.js'
import type { Settings } from '../settings.js'

let written: Partial<Settings> = {}

export async function readSettings(): Promise<Result<Settings>> {
	void getVariant()
	const data = fixture('settings.happy') as { settings: Settings }
	return { ok: true, value: { ...data.settings, ...written } }
}

/**
 * A preference change is the party's own; no counterparty and no tally is
 * touched by it (story 42 § Roles), so there is nothing here to sign.
 */
export async function writeSettings(change: Partial<Settings>): Promise<Result<Settings>> {
	written = { ...written, ...change }
	return readSettings()
}

/** Tests and scenario capture start from a known state. */
export function resetSettings(): void {
	written = {}
}
