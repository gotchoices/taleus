/**
 * In-memory test doubles for the ChipNet transport: an async byte channel, a
 * duplex `CommsStream` pair, and a `TransportNode` that routes `dialProtocol`
 * to a peer's registered handler. No libp2p, no real cadre node — enough to
 * exercise framing, correlation, timeouts, and the dispatch seam in-process.
 *
 * Excluded from the production build (see tsconfig.build.json) — test-only.
 */

import type {
	CommsStream,
	DialAddr,
	DialOptions,
	HandleOptions,
	InboundConnection,
	StreamHandler,
	TransportNode,
} from './comms.js'

/** A single-producer/single-consumer async byte queue with EOF and failure signalling. */
export class Chan {
	private readonly queue: Uint8Array[] = []
	private readonly waiters: Array<{
		resolve: (result: IteratorResult<Uint8Array>) => void
		reject: (err: unknown) => void
	}> = []
	private ended = false
	private failure: Error | null = null

	push(bytes: Uint8Array): void {
		if (this.ended || this.failure) {
			return
		}
		const waiter = this.waiters.shift()
		if (waiter) {
			waiter.resolve({ value: bytes, done: false })
		} else {
			this.queue.push(bytes)
		}
	}

	end(): void {
		if (this.ended || this.failure) {
			return
		}
		this.ended = true
		let waiter = this.waiters.shift()
		while (waiter) {
			waiter.resolve({ value: undefined, done: true })
			waiter = this.waiters.shift()
		}
	}

	fail(err: Error): void {
		if (this.failure) {
			return
		}
		this.failure = err
		let waiter = this.waiters.shift()
		while (waiter) {
			waiter.reject(err)
			waiter = this.waiters.shift()
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
		for (;;) {
			if (this.failure) {
				throw this.failure
			}
			if (this.queue.length > 0) {
				yield this.queue.shift() as Uint8Array
				continue
			}
			if (this.ended) {
				return
			}
			const result = await new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
				this.waiters.push({ resolve, reject })
			})
			if (result.done) {
				return
			}
			yield result.value
		}
	}
}

/** A connected `[dialer, listener]` duplex stream pair. */
export function makeStreamPair(): [CommsStream, CommsStream] {
	const dialerToListener = new Chan()
	const listenerToDialer = new Chan()

	const dialer: CommsStream = {
		send: (data) => {
			dialerToListener.push(data)
			return true
		},
		close: () => {
			dialerToListener.end()
			return Promise.resolve()
		},
		abort: (err) => {
			dialerToListener.fail(err)
			listenerToDialer.fail(err)
		},
		[Symbol.asyncIterator]: () => listenerToDialer[Symbol.asyncIterator](),
	}
	const listener: CommsStream = {
		send: (data) => {
			listenerToDialer.push(data)
			return true
		},
		close: () => {
			listenerToDialer.end()
			return Promise.resolve()
		},
		abort: (err) => {
			dialerToListener.fail(err)
			listenerToDialer.fail(err)
		},
		[Symbol.asyncIterator]: () => dialerToListener[Symbol.asyncIterator](),
	}
	return [dialer, listener]
}

/** A dialable address whose string form is the target peer id. */
export function addr(peerId: string): DialAddr {
	return { toString: () => peerId }
}

/** An in-memory libp2p node: routes `dialProtocol` to the target node's registered handler. */
export class InMemoryNode implements TransportNode {
	private readonly handlers = new Map<string, StreamHandler>()

	constructor(
		readonly peerId: string,
		private readonly registry: Map<string, InMemoryNode>,
	) {
		registry.set(peerId, this)
	}

	handle(protocol: string, handler: StreamHandler, _options?: HandleOptions): Promise<void> {
		this.handlers.set(protocol, handler)
		return Promise.resolve()
	}

	unhandle(protocol: string): Promise<void> {
		this.handlers.delete(protocol)
		return Promise.resolve()
	}

	dialProtocol(target: DialAddr, protocol: string, options?: DialOptions): Promise<CommsStream> {
		if (options?.signal?.aborted) {
			return Promise.reject(new Error('dial aborted before connect'))
		}
		const node = this.registry.get(target.toString())
		if (!node) {
			return Promise.reject(new Error(`unreachable: ${target.toString()}`))
		}
		const handler = node.handlers.get(protocol)
		if (!handler) {
			return Promise.reject(new Error(`no handler for ${protocol} at ${target.toString()}`))
		}
		const [dialerSide, listenerSide] = makeStreamPair()
		const connection: InboundConnection = { remotePeer: { toString: () => this.peerId } }
		void Promise.resolve().then(() => handler(listenerSide, connection))
		return Promise.resolve(dialerSide)
	}
}
