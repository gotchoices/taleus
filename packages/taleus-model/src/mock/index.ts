/**
 * The mock model: every namespace answered from fixtures, with writes kept in memory.
 *
 * One mock world per process -- the namespaces keep their writes in module state, as they did
 * when they lived in the app. `createMockModel` installs the fixture source and hands back the
 * model and its controls.
 */
import { setFixtureSource, type FixtureSource } from '../fixtures.js'
import type { MockControls, TaleusModel } from '../model.js'
import { getVariant, setVariant } from '../variant.js'
import * as attention from './attention.js'
import * as devices from './devices.js'
import * as entries from './entries.js'
import * as invitations from './invitations.js'
import * as notifications from './notifications.js'
import * as offers from './offers.js'
import * as party from './party.js'
import * as position from './position.js'
import * as profile from './profile.js'
import * as rates from './rates.js'
import * as requests from './requests.js'
import * as settings from './settings.js'
import * as standing from './standing.js'
import * as tallies from './tallies.js'
import * as tally from './tally.js'

/** Each namespace's mock writes, and how to forget them. Every namespace is listed, even with none. */
const RESETS: Record<keyof TaleusModel, (() => void)[]> = {
	attention: [attention.resetAttention],
	devices: [devices.resetDevices],
	entries: [entries.resetEntries],
	invitations: [invitations.resetInvitations],
	notifications: [notifications.resetNotifications],
	offers: [offers.resetOffers],
	party: [party.resetParty],
	profile: [profile.resetProfile],
	rates: [rates.resetRates],
	requests: [requests.resetRequests],
	settings: [settings.resetSettings],
	standing: [standing.resetStanding],
	tally: [tally.resetCloses],
	position: [],
	tallies: [],
}

export function createMockModel(fixtures: FixtureSource): { model: TaleusModel; controls: MockControls } {
	setFixtureSource(fixtures)
	const model: TaleusModel = { attention, devices, entries, invitations, notifications, offers, party, position, profile, rates, requests, settings, standing, tallies, tally }
	const controls: MockControls = {
		getVariant,
		setVariant,
		reset(namespace) {
			for (const [name, resets] of Object.entries(RESETS)) {
				if (namespace === undefined || namespace === name) {
					for (const reset of resets) reset()
				}
			}
		},
	}
	return { model, controls }
}
