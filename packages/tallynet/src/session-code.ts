/**
 * Session codes: a random, self-expiring token minted at the start of a discovery/commit session
 * and salted into every edge nonce (see `nonce.ts`). This is ChipCode's idea re-implemented on
 * `@noble/hashes` + Web Crypto, dropping ChipCode's statistical randomness tests on our **own**
 * codes (we mint them from a CSPRNG; re-testing their entropy buys nothing) while keeping a cheap
 * structural sanity check for codes that arrive from **peers**.
 *
 * Layout (32 bytes, base64url-encoded to 43 chars):
 *
 *     [0 .. 8)   expiry, milliseconds since epoch, big-endian uint64
 *     [8 .. 32)  24 random bytes
 *
 * The expiry travels inside the code, so any holder can check it without a side channel, and it is
 * covered by the nonce hash, so it cannot be altered without changing every nonce derived from it.
 *
 * Time is injected: `generate` takes the current time (defaulting to `Date.now()`); the validators
 * take `now` as an argument. Nothing here starts a timer.
 */

import { webRandomSource, type RandomSource } from './crypto.js'
import { base64urlToBytes, bytesToBase64url } from './base64url.js'

/** Total session-code length in raw bytes. */
export const SESSION_CODE_BYTES = 32
/** Bytes of the leading big-endian uint64 millisecond expiry. */
const EXPIRY_BYTES = 8
/** Random bytes following the expiry. */
const RANDOM_BYTES = SESSION_CODE_BYTES - EXPIRY_BYTES
/** base64url length of a 32-byte code, unpadded: ceil(32 * 4 / 3). */
export const SESSION_CODE_LENGTH = 43

/**
 * Default ceiling on how far in the future a peer's code may claim to expire. A code whose expiry
 * is beyond `now + this` is refused by `isValid` as implausible (a clock-skewed or hostile peer).
 * Lift sessions are short-lived; override via `isValid`'s `maxTtlMs` option when a longer horizon
 * is genuinely expected (pass `Infinity` to disable the ceiling).
 */
export const DEFAULT_MAX_TTL_MS = 3_600_000

export interface GenerateOptions {
	/** Current time, ms since epoch. Defaults to `Date.now()`. Inject for deterministic tests. */
	now?: number
	/** Random source for the 24 random bytes. Defaults to Web Crypto. */
	random?: RandomSource
}

export interface ValidateOptions {
	/** Reject a code whose expiry exceeds `now + maxTtlMs`. Defaults to {@link DEFAULT_MAX_TTL_MS}. */
	maxTtlMs?: number
}

/**
 * Mint a fresh session code valid for `ttlMs` from now. `ttlMs` must be a positive integer.
 * Returns the base64url text form.
 */
export function generate(ttlMs: number, options: GenerateOptions = {}): string {
	if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
		throw new Error(`session-code generate: ttlMs must be a positive integer, got ${String(ttlMs)}`)
	}
	const now = options.now ?? Date.now()
	const random = options.random ?? webRandomSource
	const expiry = now + ttlMs

	const bytes = new Uint8Array(SESSION_CODE_BYTES)
	new DataView(bytes.buffer).setBigUint64(0, BigInt(expiry), false)
	bytes.set(random.randomBytes(RANDOM_BYTES), EXPIRY_BYTES)
	return bytesToBase64url(bytes)
}

/**
 * The expiry encoded in `code`, ms since epoch. Throws on a malformed code (bad base64url or wrong
 * length). For untrusted input, gate with {@link isValid} first.
 */
export function expiresAt(code: string): number {
	const bytes = decode(code)
	return Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(0, false))
}

/**
 * Whether `code` has expired at `now`. A code is valid strictly **before** its expiry, so an expiry
 * exactly equal to `now` counts as expired. Throws on a malformed code; gate untrusted input with
 * {@link isValid}.
 */
export function isExpired(code: string, now: number): boolean {
	return now >= expiresAt(code)
}

/**
 * The cheap structural sanity check for a code received from a peer: right length, base64url
 * charset, canonical encoding, decodes to 32 bytes, and not all-zero. Does **not** look at expiry.
 */
export function isWellFormed(code: string): boolean {
	if (typeof code !== 'string' || code.length !== SESSION_CODE_LENGTH) {
		return false
	}
	let bytes: Uint8Array
	try {
		bytes = base64urlToBytes(code)
	} catch {
		return false
	}
	if (bytes.length !== SESSION_CODE_BYTES) {
		return false
	}
	return bytes.some((b) => b !== 0)
}

/**
 * Whether `code` is usable at `now`: well-formed, not expired, and not claiming an implausibly
 * distant expiry (more than `maxTtlMs` ahead of `now`). Never throws -- the full gate for codes
 * from peers.
 */
export function isValid(code: string, now: number, options: ValidateOptions = {}): boolean {
	if (!isWellFormed(code)) {
		return false
	}
	const maxTtlMs = options.maxTtlMs ?? DEFAULT_MAX_TTL_MS
	const expiry = expiresAt(code)
	if (now >= expiry) {
		return false
	}
	return expiry - now <= maxTtlMs
}

/** Decode `code` to its 32 raw bytes, throwing on malformed input. */
function decode(code: string): Uint8Array {
	const bytes = base64urlToBytes(code)
	if (bytes.length !== SESSION_CODE_BYTES) {
		throw new Error(`session-code: expected ${SESSION_CODE_BYTES} bytes, got ${bytes.length}`)
	}
	return bytes
}
