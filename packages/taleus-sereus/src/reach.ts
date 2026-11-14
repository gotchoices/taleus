/**
 * Whether one tally's strand node reaches the counterparty's side, from its live connections.
 *
 * A tally's strand runs its own libp2p node, which connects only to the strand's members and to
 * the relays it reaches them through. So: no open connection at all is a device with no network;
 * connections only to relays is a network without the counterparty; a connection to any other peer
 * -- direct, or through a relay's circuit -- is the counterparty's side (its phone, or a node of its
 * cadre). A relay is told apart by its place in a circuit address: the peer before `p2p-circuit`,
 * in this node's own reservation addresses or in a relayed connection's remote address.
 *
 * Not FRET's or the offline queue's cohort view (`ICohortReachability`), which keeps a departed
 * member "live" for minutes: this is the live connection, which is what a stall is judged by.
 *
 * NOTE: a relay this node holds a plain connection to but no reservation on, and no circuit through,
 * reads as the counterparty's side. That window is the seconds between dialing a relay and
 * reserving on it; a stall takes minutes. If a strand node is ever seen holding a relay that way
 * for long, also ask the peer store for the relay's hop protocol.
 */
import type { Multiaddr } from '@multiformats/multiaddr'
import type { Reach } from 'taleus-core'

/** What reach needs of a strand's libp2p node. */
export interface ConnectedNode {
	getConnections(): readonly { remotePeer: { toString(): string }; remoteAddr: Multiaddr; status: string }[]
	getMultiaddrs(): readonly Multiaddr[]
}

export function reachOf(node: ConnectedNode): Reach {
	const open = node.getConnections().filter(connection => connection.status === 'open')
	if (open.length === 0) return 'no-network'
	const relays = new Set<string>()
	for (const address of node.getMultiaddrs()) addRelay(relays, address)
	for (const connection of open) addRelay(relays, connection.remoteAddr)
	return open.some(connection => !relays.has(connection.remotePeer.toString())) ? 'connected' : 'partner-away'
}

/** The relay a circuit address goes through: the `p2p` component just before `p2p-circuit`. */
function addRelay(relays: Set<string>, address: Multiaddr): void {
	const components = address.getComponents()
	components.forEach((component, i) => {
		const before = components[i - 1]
		if (component.name === 'p2p-circuit' && before?.name === 'p2p' && before.value) relays.add(before.value)
	})
}
