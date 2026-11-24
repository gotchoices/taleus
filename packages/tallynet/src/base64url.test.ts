import { base64urlToBytes, bytesToBase64url } from './base64url.js'

describe('base64url', () => {
	it('round-trips arbitrary bytes', () => {
		for (let len = 0; len <= 40; len++) {
			const bytes = new Uint8Array(len)
			for (let i = 0; i < len; i++) {
				bytes[i] = (i * 37 + 11) & 0xff
			}
			expect(base64urlToBytes(bytesToBase64url(bytes))).toEqual(bytes)
		}
	})

	it('emits URL-safe characters only (no +, /, =)', () => {
		const bytes = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb])
		const text = bytesToBase64url(bytes)
		expect(text).toMatch(/^[A-Za-z0-9_-]*$/)
	})

	it('encodes the empty array as the empty string', () => {
		expect(bytesToBase64url(new Uint8Array(0))).toBe('')
		expect(base64urlToBytes('')).toEqual(new Uint8Array(0))
	})

	it('rejects non-base64url characters', () => {
		expect(() => base64urlToBytes('ab+c')).toThrow(/not base64url/)
		expect(() => base64urlToBytes('ab/c')).toThrow(/not base64url/)
		expect(() => base64urlToBytes('ab=c')).toThrow(/not base64url/)
	})

	it('rejects non-canonical encodings (unused trailing bits set)', () => {
		// "QQ" decodes 'A' (0x41) canonically; "QR" decodes the same byte but sets unused bits,
		// so re-encoding yields "QQ" and the strict decoder must refuse it.
		expect(base64urlToBytes('QQ')).toEqual(new Uint8Array([0x41]))
		expect(() => base64urlToBytes('QR')).toThrow(/non-canonical/)
	})
})
