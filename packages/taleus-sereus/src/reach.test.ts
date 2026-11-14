import { multiaddr } from '@multiformats/multiaddr'

import { reachOf, type ConnectedNode } from './reach.js'

const SELF = '12D3KooWSelfSelfSelfSelfSelfSelfSelfSelfSelfSelfSelf'
const RELAY = '12D3KooWRelayRelayRelayRelayRelayRelayRelayRelayRelay'
const PARTNER = '12D3KooWPartnerPartnerPartnerPartnerPartnerPartnerPa'

/** A node with these open connections (peer, remote address) and these listen addresses. */
function node(connections: [string, string][], listening: string[] = []): ConnectedNode {
	return {
		getConnections: () =>
			connections.map(([peer, address]) => ({
				remotePeer: { toString: () => peer },
				remoteAddr: multiaddr(address),
				status: 'open',
			})),
		getMultiaddrs: () => listening.map(address => multiaddr(address)),
	}
}

const relayDirect: [string, string] = [RELAY, `/dns4/relay.example/tcp/4011/wss/p2p/${RELAY}`]
const reservation = `/dns4/relay.example/tcp/4011/wss/p2p/${RELAY}/p2p-circuit/p2p/${SELF}`

describe('reach of a strand node', () => {
	it('is no-network with no open connection', () => {
		expect(reachOf(node([]))).toBe('no-network')
	})

	it('is partner-away holding only its relay', () => {
		expect(reachOf(node([relayDirect], [reservation]))).toBe('partner-away')
	})

	it('is connected through a relayed circuit to the partner', () => {
		const partner: [string, string] = [PARTNER, `/dns4/relay.example/tcp/4011/wss/p2p/${RELAY}/p2p-circuit/p2p/${PARTNER}`]
		expect(reachOf(node([relayDirect, partner]))).toBe('connected')
	})

	it('is connected directly to the partner', () => {
		expect(reachOf(node([[PARTNER, `/ip4/127.0.0.1/tcp/40123/ws/p2p/${PARTNER}`]]))).toBe('connected')
	})
})
