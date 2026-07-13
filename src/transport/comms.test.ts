import {
	decodeLengthPrefixedFrame,
	readFrame,
	readStreamToEnd,
	writeFrame,
	withTimeout,
	type CommsStream,
} from './comms.js'
import { Chan, makeStreamPair } from './test-harness.js'

describe('comms framing', () => {
	it('round-trips a JSON value through writeFrame/readFrame over a stream pair', async () => {
		const [dialer, listener] = makeStreamPair()
		const value = { kind: 'query-request', nonce: 'abc', body: { a: 1, b: [2, 3], c: 'x' } }

		writeFrame(dialer, value)
		await dialer.close()

		const got = await readFrame<typeof value>(listener, { maxBytes: 4096, timeoutMs: 1000, label: 'test' })
		expect(got).toEqual(value)
	})

	it('encodes a 4-byte big-endian length prefix', () => {
		const captured: Uint8Array[] = []
		const sink: CommsStream = {
			send: (d) => {
				captured.push(d)
				return true
			},
			close: () => Promise.resolve(),
			abort: () => {},
			[Symbol.asyncIterator]: async function* () {},
		}
		writeFrame(sink, 'hi')

		const [prefix, body] = captured
		expect(prefix.length).toBe(4)
		const declared = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(0, false)
		expect(declared).toBe(body.length)
		expect(body.length).toBe(new TextEncoder().encode(JSON.stringify('hi')).length)
	})

	describe('decodeLengthPrefixedFrame', () => {
		it('strips the prefix and returns the body', () => {
			const body = new TextEncoder().encode('payload')
			const framed = new Uint8Array(4 + body.length)
			new DataView(framed.buffer).setUint32(0, body.length, false)
			framed.set(body, 4)
			expect(new TextDecoder().decode(decodeLengthPrefixedFrame(framed, 1024))).toBe('payload')
		})

		it('rejects a truncated prefix', () => {
			expect(() => decodeLengthPrefixedFrame(new Uint8Array([0, 0]), 1024)).toThrow(/too short/)
		})

		it('rejects a declared length over the max (oversized frame guard)', () => {
			const framed = new Uint8Array(8)
			new DataView(framed.buffer).setUint32(0, 1_000_000, false)
			expect(() => decodeLengthPrefixedFrame(framed, 16)).toThrow(/exceeding max/)
		})

		it('rejects a declared length exceeding the bytes present', () => {
			const framed = new Uint8Array(8)
			new DataView(framed.buffer).setUint32(0, 100, false)
			expect(() => decodeLengthPrefixedFrame(framed, 1024)).toThrow(/only 4 body bytes/)
		})
	})

	describe('readStreamToEnd', () => {
		it('aborts and rejects when the peer never half-closes its write end', async () => {
			// A channel that receives one chunk but is never ended: the read would hang forever.
			const chan = new Chan()
			chan.push(new Uint8Array([1, 2, 3]))
			let aborted = false
			const stalled: CommsStream = {
				send: () => true,
				close: () => Promise.resolve(),
				abort: (err) => {
					aborted = true
					chan.fail(err)
				},
				[Symbol.asyncIterator]: () => chan[Symbol.asyncIterator](),
			}

			await expect(
				readStreamToEnd(stalled, { maxBytes: 4096, timeoutMs: 30, label: 'stall' }),
			).rejects.toThrow(/timed out after 30ms/)
			expect(aborted).toBe(true)
		})

		it('rejects a body that exceeds maxBytes', async () => {
			const [dialer, listener] = makeStreamPair()
			dialer.send(new Uint8Array(64))
			void dialer.close()
			await expect(
				readStreamToEnd(listener, { maxBytes: 16, timeoutMs: 1000, label: 'big' }),
			).rejects.toThrow(/too large/)
		})
	})

	describe('withTimeout', () => {
		it('resolves a fast op and clears the timer', async () => {
			await expect(withTimeout(1000, 'fast', () => Promise.resolve(42))).resolves.toBe(42)
		})

		it('rejects and invokes onTimeout when the op is too slow', async () => {
			let cleaned = false
			await expect(
				withTimeout(
					20,
					'slow',
					() => new Promise((resolve) => setTimeout(resolve, 1000)),
					() => {
						cleaned = true
					},
				),
			).rejects.toThrow(/slow timed out after 20ms/)
			expect(cleaned).toBe(true)
		})
	})
})
