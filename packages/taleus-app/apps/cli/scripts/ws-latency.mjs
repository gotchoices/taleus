/**
 * Preload (`node --import ./scripts/ws-latency.mjs`): holds every outbound frame of every WebSocket
 * this process dials, `TALEUS_WS_DELAY_MS` ms each -- `pipelined` (latency: frames overlap in flight)
 * or `serial` (`TALEUS_WS_MODE=serial`: one frame at a time per socket, a frame-rate cap, the shape a
 * busy phone's sends take). The core of sereus's `integration-tests/src/harness/ws-latency.ts`,
 * which says more on what each mode measures. Only dialed sockets: a listener's are untouched.
 */
const delayMs = Number(process.env.TALEUS_WS_DELAY_MS ?? 0)
const serial = process.env.TALEUS_WS_MODE === 'serial'

if (delayMs > 0) {
	const Native = globalThis.WebSocket
	globalThis.WebSocket = class DelayedWebSocket extends Native {
		#chain = Promise.resolve()
		#queued = 0
		send(data) {
			const bytes = typeof data === 'string' ? data.length : (data.byteLength ?? data.size ?? 0)
			this.#queued += bytes
			const release = () => {
				try {
					// The socket can close while a frame waits its turn: an ordinary outcome here.
					if (this.readyState === Native.OPEN) super.send(data)
				} finally {
					this.#queued -= bytes
				}
			}
			if (!serial) {
				setTimeout(release, delayMs)
				return
			}
			this.#chain = this.#chain.then(() => new Promise(resolve => setTimeout(resolve, delayMs))).then(release)
		}
		/** What this shim holds plus what the socket has not flushed: libp2p's backpressure reads it. */
		get bufferedAmount() {
			return this.#queued + super.bufferedAmount
		}
	}
}
