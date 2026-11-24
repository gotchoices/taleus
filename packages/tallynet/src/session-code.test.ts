import {
	generate,
	expiresAt,
	isExpired,
	isValid,
	isWellFormed,
	SESSION_CODE_LENGTH,
	DEFAULT_MAX_TTL_MS,
} from './session-code.js'
import type { RandomSource } from './crypto.js'

/** A deterministic RandomSource for reproducible codes: every byte is `fill`. */
function fixedRandom(fill: number): RandomSource {
	return { randomBytes: (length) => new Uint8Array(length).fill(fill) }
}

describe('session-code generate', () => {
	it('produces a 43-char base64url code carrying the expiry', () => {
		const now = 1_700_000_000_000
		const code = generate(60_000, { now, random: fixedRandom(0xab) })
		expect(code.length).toBe(SESSION_CODE_LENGTH)
		expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
		expect(expiresAt(code)).toBe(now + 60_000)
	})

	it('is deterministic given a fixed clock and random source', () => {
		const opts = { now: 42, random: fixedRandom(0x01) }
		expect(generate(1000, opts)).toBe(generate(1000, opts))
	})

	it('rejects a non-positive or non-integer ttl', () => {
		expect(() => generate(0)).toThrow()
		expect(() => generate(-5)).toThrow()
		expect(() => generate(1.5)).toThrow()
	})
})

describe('session-code expiry', () => {
	const now = 1_000_000
	const ttl = 5_000
	const code = generate(ttl, { now, random: fixedRandom(0x7f) })

	it('is valid strictly before expiry and expired at exactly the expiry instant', () => {
		expect(isExpired(code, now + ttl - 1)).toBe(false)
		expect(isExpired(code, now + ttl)).toBe(true)
		expect(isExpired(code, now + ttl + 1)).toBe(true)
	})

	it('isValid tracks the same boundary', () => {
		expect(isValid(code, now)).toBe(true)
		expect(isValid(code, now + ttl - 1)).toBe(true)
		expect(isValid(code, now + ttl)).toBe(false)
	})
})

describe('session-code isValid guards against peer input', () => {
	it('rejects a code whose expiry is implausibly far in the future (clock skew / hostile)', () => {
		const now = 0
		const code = generate(DEFAULT_MAX_TTL_MS + 60_000, { now, random: fixedRandom(0x11) })
		expect(isValid(code, now)).toBe(false)
		// A caller that genuinely expects the longer horizon can widen the ceiling.
		expect(isValid(code, now, { maxTtlMs: DEFAULT_MAX_TTL_MS + 120_000 })).toBe(true)
		expect(isValid(code, now, { maxTtlMs: Infinity })).toBe(true)
	})

	it('rejects malformed base64, wrong length, and all-zero codes', () => {
		expect(isValid('!'.repeat(SESSION_CODE_LENGTH), 0)).toBe(false)
		expect(isValid('abc', 0)).toBe(false)
		expect(isValid('A'.repeat(SESSION_CODE_LENGTH), 0)).toBe(false) // 32 zero bytes
	})
})

describe('session-code isWellFormed', () => {
	it('accepts a freshly generated code', () => {
		expect(isWellFormed(generate(1000, { now: 1, random: fixedRandom(0x22) }))).toBe(true)
	})

	it('rejects wrong length, bad charset, and the all-zero code', () => {
		expect(isWellFormed('abc')).toBe(false)
		expect(isWellFormed('+'.repeat(SESSION_CODE_LENGTH))).toBe(false)
		expect(isWellFormed('A'.repeat(SESSION_CODE_LENGTH))).toBe(false)
	})
})

describe('session-code expiresAt', () => {
	it('throws on a malformed code', () => {
		expect(() => expiresAt('abc')).toThrow()
		expect(() => expiresAt('+'.repeat(SESSION_CODE_LENGTH))).toThrow()
	})
})
