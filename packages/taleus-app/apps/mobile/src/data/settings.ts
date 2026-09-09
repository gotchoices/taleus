import { mockMode } from './config'
import { getVariant } from '../mock/variant'
import type { UnitStyle } from '../util/amount'
import { engineAbsent, type Result, type Unit } from './types'

export interface Locale {
	tag: string
	name: string
}

/** A unit the party actually holds, and whether they have priced it. */
export interface HeldUnit extends Unit {
	/** Whether the party has said what this unit is worth to them (story 41). */
	priced: boolean
}

/**
 * Preferences, and only preferences (story 42).
 *
 * What a party lets a partner owe, and how value may move through their
 * tallies, look like settings and are not: they are agreements and signed
 * permissions, and they live with the tally and with trading settings. Path C
 * is explicit that they must not sit among choices about colours and language,
 * so they are absent from this shape rather than merely absent from the screen.
 */
export interface Settings {
	/** Follows the party to every device. */
	locale: string
	/** Follows the party. Per-tally units are not this, and are not the party's to change. */
	displayUnit: string
	/** Follows the party — `$180` or `USD 180`, everywhere. */
	unitStyle: UnitStyle
	/** Belongs to the device in hand. */
	appearance: 'system' | 'light' | 'dark'
	availableLocales: Locale[]
	unitsHeld: HeldUnit[]
}

/**
 * Which of a party's choices travel with them and which stay on one device
 * (story 42 steps 6-7, path D). The screen groups by these rather than by a
 * hand-written heading per row, so a preference added later cannot quietly land
 * in the wrong group.
 */
export const followsParty = ['locale', 'displayUnit', 'unitStyle'] as const
export const belongsToDevice = ['appearance'] as const

let written: Partial<Settings> = {}

export async function readSettings(): Promise<Result<Settings>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	void getVariant()
	const data = require('../../mock/data/settings.happy.json') as { settings: Settings }
	return { ok: true, value: { ...data.settings, ...written } }
}

/**
 * A preference change is the party's own; no counterparty and no tally is
 * touched by it (story 42 § Roles), so there is nothing here to sign.
 */
export async function writeSettings(change: Partial<Settings>): Promise<Result<Settings>> {
	if (!mockMode) {
		return { ok: false, error: engineAbsent }
	}
	written = { ...written, ...change }
	return readSettings()
}

/** Tests and scenario capture start from a known state. */
export function resetSettings(): void {
	written = {}
}
