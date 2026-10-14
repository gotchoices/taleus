/** This party and its node: `status`, `party`, `relay`. */
import { peerAt } from 'taleus-sereus/node'

import { resolveRelayAddress } from '../relay-address.ts'
import { CliFailure, EXIT, UsageError, type Session } from '../session.ts'
import { need, type Command } from './command.ts'

const status: Command = {
	name: 'status',
	noArgs: true,
	summary: 'This party, its node, and whether it can be reached',
	usage: '',
	async run(session) {
		const { party } = session
		const me = session.unwrap(await party.model.party.readParty())
		const relay = party.node.getRelayReservationState()
		const tallies = await party.model.tallies.listTallies()
		session.out.pairs([
			['party', party.dirs.name],
			['sid', me?.sid],
			['name', me?.displayName],
			['peer', party.node.peerId?.toString()],
			['partyId', party.config.partyId],
			['relay', relayAddrs(session).map(addr => [relay?.status ?? 'none', addr])],
			['address', addresses(session)],
			['tallies', tallies.ok ? tallies.value.length : null],
		])
	},
}

function relayAddrs(session: Session): string[] {
	return session.party.config.relays
}

function addresses(session: Session): string[] {
	return session.party.node.getControlNode()?.getMultiaddrs().map(addr => addr.toString()) ?? []
}

const party: Command = {
	name: 'party',
	summary: 'Show this party, or name it (creating its identity on first use): party name Kyle',
	usage: '[name <name>]',
	async run(session, args) {
		const model = session.party.model.party
		if (args[0] === 'name') {
			const name = args.slice(1).join(' ').trim()
			if (!name) throw new UsageError(`party: missing the name\nusage: party ${party.usage}`)
			if (!session.unwrap(await model.readParty())) session.unwrap(await model.createIdentity())
			session.unwrap(await model.setDisplayName(name))
		} else if (args.length) {
			throw new UsageError(`usage: party ${party.usage}`)
		}
		const me = session.unwrap(await model.readParty())
		session.out.pairs([
			['sid', me?.sid],
			['name', me?.displayName],
		])
	},
}

/** How long `relay add` waits for the relay to grant a reservation before reporting. */
const RESERVATION_WAIT_MS = 30_000

const relay: Command = {
	name: 'relay',
	summary: 'List relays, or add one (a host name is enough: relay add relay.sereus.org) or remove one',
	usage: '[add <host[:port] | multiaddr> | remove <multiaddr|row>]',
	async run(session, args) {
		const saved = session.party.config.relays
		const [action] = args
		if (action === 'add' || action === 'remove') {
			const given = need(relay, args, 1, action === 'add' ? 'relay (a host name, host:port or multiaddr)' : 'relay')
			const next = action === 'add' ? await adding(session, given, saved) : removing(given, saved)
			if (next !== saved) {
				session.out.note('restarting the node with the new relays…')
				await session.party.applyRelays(next)
			}
			if (next.length) await awaitReservation(session)
		} else if (action) {
			throw new UsageError(`usage: relay ${relay.usage}`)
		}
		const state = session.party.node.getRelayReservationState()
		session.out.rows(['row', 'status', 'multiaddr'], session.party.config.relays.map((addr, i) => ({
			row: i + 1,
			status: state?.status ?? 'none',
			multiaddr: addr,
		})))
	},
}

async function adding(session: Session, given: string, saved: string[]): Promise<string[]> {
	let resolved
	try {
		resolved = await resolveRelayAddress(given, address => peerAt(session.party.node, address))
	} catch (error) {
		throw new CliFailure(`relay: ${(error as Error).message}`, EXIT.retryable)
	}
	const peer = resolved.addr.slice(resolved.addr.lastIndexOf('/p2p/') + 5)
	if (resolved.source !== 'as given') session.out.note(`relay ${given}: ${resolved.addr}\n  its peer id ${peer} was ${resolved.source}`)
	// The same relay under another name is one relay, identified by its peer id.
	const already = saved.find(addr => addr.endsWith(`/p2p/${peer}`))
	if (already) {
		session.out.note(`relay: already using that relay (${peer}) as ${already}`)
		return saved
	}
	return [...saved, resolved.addr]
}

function removing(given: string, saved: string[]): string[] {
	const target = /^\d+$/.test(given) ? saved[Number(given) - 1] : given
	if (!target || !saved.includes(target)) throw new UsageError(`relay: no saved relay ${JSON.stringify(given)}`)
	return saved.filter(addr => addr !== target)
}

async function awaitReservation(session: Session): Promise<void> {
	const reserved = () => session.party.node.getRelayReservationState()?.status === 'reserved'
	const deadline = Date.now() + RESERVATION_WAIT_MS
	while (Date.now() < deadline && !reserved()) await new Promise(resolve => setTimeout(resolve, 500))
	if (!reserved()) session.out.note(`no reservation yet (${session.party.node.getRelayReservationState()?.status ?? 'no status'}); it keeps trying -- see "relay"`)
}

export const setupCommands = [status, party, relay]
