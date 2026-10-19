/**
 * A circuit relay on loopback, for tests and scripted scenarios: parties that reach each other only
 * through it behave as phones do through a public relay, and -- unlike parties dialing each other's
 * listen addresses, whose ports change with every run -- they find each other again after a restart.
 * With `delayMs`, every byte through it is held that long in each direction, so each party's link to
 * the relay behaves like a real network's: a party-to-party round trip costs four times the delay.
 */
import { createServer, connect, type Server, type Socket } from 'node:net'
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
	/**
	 * Hold every byte this long, each way, on each party's link to the relay (a loopback proxy in
	 * front of it). A round trip between two parties through the relay then costs `4 * delayMs`.
	 */
	delayMs?: number
}

/** Start a relay listening on loopback. */
export async function startLocalRelay(options: LocalRelayOptions = {}): Promise<LocalRelay> {
	const { port = 0, defaultLimits = false, delayMs = 0 } = options
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
	const direct = node.getMultiaddrs().map(addr => addr.toString()).find(addr => addr.includes('/ws'))
	if (!direct) {
		await node.stop()
		throw new Error('the local relay has no WebSocket address')
	}
	const proxy = delayMs > 0 ? await startDelayProxy(Number(/\/tcp\/(\d+)\//.exec(direct)?.[1]), delayMs) : undefined
	const address = proxy ? direct.replace(/\/tcp\/\d+\//, `/tcp/${proxy.port}/`) : direct
	return {
		address,
		async stop() {
			await proxy?.stop()
			await node.stop()
		},
	}
}

interface DelayProxy {
	readonly port: number
	stop(): Promise<void>
}

/** A loopback TCP proxy to `target`, holding each chunk `delayMs` in either direction, in order. */
async function startDelayProxy(target: number, delayMs: number): Promise<DelayProxy> {
	const sockets = new Set<Socket>()
	const server: Server = createServer(client => {
		const upstream = connect(target, '127.0.0.1')
		for (const socket of [client, upstream]) {
			sockets.add(socket)
			socket.on('close', () => sockets.delete(socket))
			socket.on('error', () => {
				client.destroy()
				upstream.destroy()
			})
		}
		forward(client, upstream, delayMs)
		forward(upstream, client, delayMs)
	})
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => resolve())
	})
	return {
		port: (server.address() as { port: number }).port,
		stop: () =>
			new Promise<void>(resolve => {
				for (const socket of sockets) socket.destroy()
				server.close(() => resolve())
			}),
	}
}

/** Copy `from` to `to`, each chunk and the end delivered `delayMs` late; equal delays keep the order. */
function forward(from: Socket, to: Socket, delayMs: number): void {
	from.on('data', chunk => {
		setTimeout(() => {
			if (!to.destroyed) to.write(chunk)
		}, delayMs)
	})
	from.on('end', () => {
		setTimeout(() => to.end(), delayMs)
	})
}
