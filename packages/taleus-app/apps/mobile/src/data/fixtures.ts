import type { FixtureSource } from 'taleus-model'

/**
 * The mock fixtures, by name, for the mock model.
 *
 * This map has to live in the app: Metro only bundles a JSON file it can see a
 * static \`require\` for, so the model cannot find fixtures by path. Each entry
 * stays lazy, so a fixture is parsed the first time it is asked for, as before.
 * A name the model asks for and this map lacks is a bug -- it throws, loudly.
 */
const FIXTURES: Record<string, () => unknown> = {
	'agreements.happy': () => require('../../mock/data/agreements.happy.json'),
	'attention.empty': () => require('../../mock/data/attention.empty.json'),
	'attention.error': () => require('../../mock/data/attention.error.json'),
	'attention.happy': () => require('../../mock/data/attention.happy.json'),
	'entries.empty': () => require('../../mock/data/entries.empty.json'),
	'entries.error': () => require('../../mock/data/entries.error.json'),
	'entries.happy': () => require('../../mock/data/entries.happy.json'),
	'invitation.expired': () => require('../../mock/data/invitation.expired.json'),
	'invitation.happy': () => require('../../mock/data/invitation.happy.json'),
	'invitations.empty': () => require('../../mock/data/invitations.empty.json'),
	'invitations.happy': () => require('../../mock/data/invitations.happy.json'),
	'notifications.error': () => require('../../mock/data/notifications.error.json'),
	'notifications.happy': () => require('../../mock/data/notifications.happy.json'),
	'offer.empty': () => require('../../mock/data/offer.empty.json'),
	'offer.happy': () => require('../../mock/data/offer.happy.json'),
	'offer.superseded': () => require('../../mock/data/offer.superseded.json'),
	'party.first-run': () => require('../../mock/data/party.first-run.json'),
	'party.happy': () => require('../../mock/data/party.happy.json'),
	'party.naming': () => require('../../mock/data/party.naming.json'),
	'party.single-device': () => require('../../mock/data/party.single-device.json'),
	'position.empty': () => require('../../mock/data/position.empty.json'),
	'position.happy': () => require('../../mock/data/position.happy.json'),
	'profile.empty': () => require('../../mock/data/profile.empty.json'),
	'profile.error': () => require('../../mock/data/profile.error.json'),
	'profile.happy': () => require('../../mock/data/profile.happy.json'),
	'rates.error': () => require('../../mock/data/rates.error.json'),
	'rates.happy': () => require('../../mock/data/rates.happy.json'),
	'requests.empty': () => require('../../mock/data/requests.empty.json'),
	'requests.happy': () => require('../../mock/data/requests.happy.json'),
	'settings.happy': () => require('../../mock/data/settings.happy.json'),
	'standing.empty': () => require('../../mock/data/standing.empty.json'),
	'standing.happy': () => require('../../mock/data/standing.happy.json'),
	'tallies.empty': () => require('../../mock/data/tallies.empty.json'),
	'tallies.error': () => require('../../mock/data/tallies.error.json'),
	'tallies.happy': () => require('../../mock/data/tallies.happy.json'),
	'tally.closing': () => require('../../mock/data/tally.closing.json'),
	'tally.error': () => require('../../mock/data/tally.error.json'),
	'tally.happy': () => require('../../mock/data/tally.happy.json'),
	'terms.error': () => require('../../mock/data/terms.error.json'),
	'terms.happy': () => require('../../mock/data/terms.happy.json'),
}

export const fixtureSource: FixtureSource = name => {
	const load = FIXTURES[name]
	if (!load) {
		throw new Error(`no fixture named '${name}' is bundled`)
	}
	return load()
}
