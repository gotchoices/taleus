/**
 * A circuit relay on loopback, for tests and scripted scenarios: parties that reach each other only
 * through it behave as phones do through a public relay, and -- unlike parties dialing each other's
 * listen addresses, whose ports change with every run -- they find each other again after a restart.
 */
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { webSockets } from '@libp2p/websockets'
import { createLibp2p } from 'libp2p'

export interface LocalRelay {
	/** The relay's WebSocket multiaddr, with its peer id: what a party adds as its relay. */
	readonly address: string
	stop(): Promise<void>
}

/** Start a relay listening on loopback (`port` 0: any free port). */
export async function startLocalRelay(port = 0): Promise<LocalRelay> {
	const node = await createLibp2p({
		addresses: { listen: [`/ip4/127.0.0.1/tcp/${port}/ws`] },
		transports: [webSockets()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		connectionGater: { denyDialMultiaddr: () => false },
		services: {
			identify: identify(),
			relay: circuitRelayServer({ reservations: { applyDefaultLimit: false } }),
		},
	})
	const address = node.getMultiaddrs().map(addr => addr.toString()).find(addr => addr.includes('/ws'))
	if (!address) {
		await node.stop()
		throw new Error('the local relay has no WebSocket address')
	}
	return {
		address,
		async stop() {
			await node.stop()
		},
	}
}
