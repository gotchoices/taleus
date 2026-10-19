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

export interface LocalRelayOptions {
	/** Port to listen on; 0 (the default) takes any free one. */
	port?: number
	/**
	 * Apply libp2p's default per-connection limits (2 minutes, 128 KiB), as a stock public relay
	 * does. Off by default, so a relayed connection lasts as long as the parties need it.
	 */
	defaultLimits?: boolean
}

/** Start a relay listening on loopback. */
export async function startLocalRelay(options: LocalRelayOptions = {}): Promise<LocalRelay> {
	const { port = 0, defaultLimits = false } = options
	const node = await createLibp2p({
		addresses: { listen: [`/ip4/127.0.0.1/tcp/${port}/ws`] },
		transports: [webSockets()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		connectionGater: { denyDialMultiaddr: () => false },
		services: {
			identify: identify(),
			relay: circuitRelayServer({ reservations: { applyDefaultLimit: defaultLimits } }),
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
