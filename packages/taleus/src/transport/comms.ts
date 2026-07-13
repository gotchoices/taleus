/**
 * Shared cadre-to-cadre stream primitives for the `/taleus/chipnet/1.0.0`
 * transport (see docs/architecture.md § Transport). ChipNet is a meta-protocol
 * that never opens a socket — it calls host callbacks to move messages. This
 * module is the byte-level plumbing beneath those callbacks: a minimal libp2p
 * stream surface, a 4-byte big-endian length-prefixed JSON frame codec, and
 * timeout-bounded reads so one dead edge cannot stall a discovery round.
 *
 * It deliberately mirrors Sereus's own control-network stream shape
 * (`@serfab/cadre-core`'s internal `control-stream.ts`, used by
 * `/sereus/strand-wake` and `/sereus/seed`): same frame format, same
 * abort-on-timeout read-to-EOF posture. That module is not exported by
 * cadre-core, so the shape is reproduced here rather than imported. Keeping the
 * two byte-compatible is intentional — the two protocols coexist on the same
 * cadre nodes.
 *
 * Dependency-free by design (only `TextEncoder`/`TextDecoder`/`DataView`, all
 * cross-platform): the transport runs unchanged in Node, the browser, and
 * NativeScript. The libp2p node and stream are modeled as structural ports (a
 * real `@serfab/cadre-core` `CadreNode`'s libp2p node satisfies `TransportNode`;
 * a real libp2p 3.x stream satisfies `CommsStream`) so this compiles and unit-
 * tests without the heavy optimystic/libp2p runtime tree.
 */

/**
 * Minimal libp2p 3.x stream surface the transport uses: `AsyncIterable` for
 * reads, `send()` for writes, `close()` to half-close the write end (signals
 * EOF to the peer while the read end stays open for the response), and
 * `abort()` to reset a stalled stream. A real libp2p stream satisfies this
 * structurally.
 */
export interface CommsStream extends AsyncIterable<Uint8Array> {
	send(data: Uint8Array): boolean
	close(): Promise<void>
	abort(err: Error): void
}

/** A dialable address. A real `@multiformats/multiaddr` `Multiaddr` satisfies this. */
export interface DialAddr {
	toString(): string
}

/** The remote end of an inbound stream, as libp2p reports it to a protocol handler. */
export interface InboundConnection {
	remotePeer: { toString(): string }
}

/** Handler libp2p invokes for each inbound stream on a registered protocol. */
export type StreamHandler = (stream: CommsStream, connection: InboundConnection) => void | Promise<void>

/** libp2p `handle` options; `runOnLimitedConnection` is required for the relay path. */
export interface HandleOptions {
	runOnLimitedConnection?: boolean
}

/** libp2p `dialProtocol` options. */
export interface DialOptions {
	runOnLimitedConnection?: boolean
	signal?: AbortSignal
}

/**
 * Minimal libp2p node surface the transport needs. A real `CadreNode`'s libp2p
 * node satisfies this: it registers protocol handlers and opens outbound
 * protocol streams. Injected as a port so the transport is testable against an
 * in-memory node without standing up a real cadre.
 */
export interface TransportNode {
	handle(protocol: string, handler: StreamHandler, options?: HandleOptions): Promise<void>
	unhandle(protocol: string): Promise<void>
	dialProtocol(addr: DialAddr, protocol: string, options?: DialOptions): Promise<CommsStream>
}

/**
 * Write a value as a single 4-byte big-endian length-prefixed JSON frame.
 *
 * NOTE: `send()`'s backpressure return is ignored. Fine for ChipNet's small
 * discovery/commit frames (well under `maxFrameBytes`); if frames ever approach
 * that cap, honor the return (await drain) rather than over-buffering the stream.
 */
export function writeFrame(stream: CommsStream, value: unknown): void {
	const body = new TextEncoder().encode(JSON.stringify(value))
	const prefix = new Uint8Array(4)
	new DataView(prefix.buffer).setUint32(0, body.length, false)
	stream.send(prefix)
	stream.send(body)
}

/**
 * Validate and strip the 4-byte big-endian length prefix, returning the body
 * bytes. Rejects a truncated prefix, a declared length over `maxLength`, and a
 * declared length exceeding the bytes actually present — the malformed/oversized
 * frame guard.
 */
export function decodeLengthPrefixedFrame(data: Uint8Array, maxLength: number): Uint8Array {
	if (data.length < 4) {
		throw new Error(`Frame too short: ${data.length} bytes, need >=4 for length prefix`)
	}
	const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false)
	const available = data.length - 4
	if (length > maxLength) {
		throw new Error(`Frame declares length ${length} exceeding max ${maxLength}`)
	}
	if (length > available) {
		throw new Error(`Frame declares length ${length} but only ${available} body bytes present`)
	}
	return data.subarray(4, 4 + length)
}

/**
 * Reject if `op` does not settle within `ms`. On timeout, `onTimeout` runs
 * (used to abort the in-flight dial/stream so it does not leak) before the
 * rejection. A throwing `onTimeout` is swallowed so it cannot mask the timeout.
 */
export function withTimeout<T>(
	ms: number,
	label: string,
	op: () => Promise<T>,
	onTimeout?: () => void,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			try {
				onTimeout?.()
			} catch {
				// Best-effort: a throwing onTimeout must not replace the timeout error.
			}
			reject(new Error(`${label} timed out after ${ms}ms`))
		}, ms)
		op().then(resolve, reject).finally(() => clearTimeout(timer))
	})
}

/** Normalize a libp2p chunk (Uint8Array or Uint8ArrayList) to a flat Uint8Array. */
function toBytes(chunk: Uint8Array | { subarray(): Uint8Array }): Uint8Array {
	return chunk instanceof Uint8Array ? chunk : chunk.subarray()
}

/** Accumulate every chunk to EOF, rejecting once the running total exceeds `maxBytes`. */
async function collect(stream: CommsStream, maxBytes: number, label: string): Promise<Uint8Array> {
	const chunks: Uint8Array[] = []
	let total = 0
	for await (const chunk of stream) {
		const bytes = toBytes(chunk)
		chunks.push(bytes)
		total += bytes.length
		if (total > maxBytes) {
			throw new Error(`${label} message too large: ${total} bytes exceeds max ${maxBytes}`)
		}
	}
	const data = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		data.set(chunk, offset)
		offset += chunk.length
	}
	return data
}

/**
 * Read a stream to EOF, capped at `maxBytes`, bounded by `timeoutMs`. On
 * timeout the stuck read is `abort()`ed and the promise rejects — a peer that
 * half-opens a stream and never half-closes its write end cannot pin the reader
 * forever. The race settles at the deadline even if `abort()` does not promptly
 * unblock the iterator.
 */
export function readStreamToEnd(
	stream: CommsStream,
	opts: { maxBytes: number; timeoutMs: number; label: string },
): Promise<Uint8Array> {
	const { maxBytes, timeoutMs, label } = opts
	let timer: ReturnType<typeof setTimeout> | undefined

	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			const err = new Error(`${label} read timed out after ${timeoutMs}ms`)
			try {
				stream.abort(err)
			} catch {
				// Best-effort: a broken/closed stream may reject abort.
			}
			reject(err)
		}, timeoutMs)
	})

	return Promise.race([collect(stream, maxBytes, label), timeout]).finally(() => clearTimeout(timer))
}

/**
 * Read a stream to EOF (bounded + capped) and decode the single length-prefixed
 * JSON frame it carries into `T`.
 */
export async function readFrame<T>(
	stream: CommsStream,
	opts: { maxBytes: number; timeoutMs: number; label: string },
): Promise<T> {
	const data = await readStreamToEnd(stream, opts)
	const body = decodeLengthPrefixedFrame(data, opts.maxBytes)
	return JSON.parse(new TextDecoder().decode(body)) as T
}
