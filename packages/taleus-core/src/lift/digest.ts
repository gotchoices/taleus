/**
 * The **cross-primitive digest contract** for lift commit (see docs/architecture.md
 * § Referee model and the commit seam, "Cross-primitive constraint"). The per-edge digest
 * the referee signs here MUST be byte-identical to what the schema's `digest()` recomputes,
 * so that a referee signature verifies under the schema's `verify(…, 'ed25519')`
 * (`Ledger.LiftFinalize` / `LiftVoid.RefereeVoidValid` in schema/draft1.qsql). A one-byte
 * divergence means every finalize silently fails to settle.
 *
 * Two digest forms are used, both defined by the schema:
 *   - lift-terms digest — `digest(Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry)`,
 *     signed by the issuer (`PendingLift.SignatureValid`) AND by the referee at commit
 *     (`Ledger.LiftFinalize`). The issuer pledge and the referee commit are two signatures
 *     over the *same* digest, verified against different keys.
 *   - void digest — `digest(Cid, LiftId, 'void')` (`LiftVoid.RefereeVoidValid`). Deliberately
 *     DISTINCT from the lift-terms digest, so a commit signature can never be replayed as a
 *     void or vice versa.
 *
 * ── The encoding is the stack's, not ours ─────────────────────────────────────
 * The schema's `digest()` and `verify()` are `@optimystic/quereus-plugin-crypto`'s, which
 * Sereus composes into every strand database. Its `digest` is an injective, type-tagged,
 * length-framed encoding over an ordered tuple of fields, then sha256 -- the property this
 * file used to implement itself, back when no runner registered a `Digest()` at all. Keeping
 * a second implementation would now be worse than redundant: Quereus resolves function names
 * case-insensitively, so a Taleus `Digest` registered beside the plugin's `digest` replaces it
 * in every schema on the database, Sereus's own membership constraints included.
 *
 * So this file does not encode anything. It delegates to the plugin's `digest`, asks for raw
 * bytes, and signs those -- which is what the plugin's `verify` checks: it decodes the
 * digest text back to bytes before verifying.
 */

import { digest as stackDigest } from '@optimystic/quereus-plugin-crypto'
import { sign, verify } from '../crypto/index.js'

/* ── hex codec: identifiers only, not the schema's text form ──────────────────── */

// Plain lowercase hex for things that are not keys, signatures or digests -- generated ids,
// an invitation ticket's payload. The schema's own text form is base64url; see below.

const HEX = '0123456789abcdef'

/** Encode raw bytes as lowercase hex text. Not the schema's key form -- see `toText`. */
export function bytesToHex(bytes: Uint8Array): string {
	let out = ''
	for (const b of bytes) {
		out += HEX[b >> 4] + HEX[b & 0x0f]
	}
	return out
}

/** One hex char → its 0-15 nibble, or -1 if not a hex digit. */
function hexNibble(code: number): number {
	if (code >= 0x30 && code <= 0x39) { // '0'-'9'
		return code - 0x30
	}
	if (code >= 0x61 && code <= 0x66) { // 'a'-'f'
		return code - 0x61 + 10
	}
	if (code >= 0x41 && code <= 0x46) { // 'A'-'F'
		return code - 0x41 + 10
	}
	return -1
}

/**
 * Decode lowercase/uppercase hex text back to raw bytes. Rejects malformed input —
 * per-nibble validation, so `Number.parseInt`'s prefix-parsing laxness (which silently
 * accepts `'0g'` as `0` or `' a'` as `10`) can never let a junk character through.
 */
export function hexToBytes(hex: string): Uint8Array {
	if (hex.length % 2 !== 0) {
		throw new Error(`hexToBytes: odd-length hex string (${hex.length})`)
	}
	const out = new Uint8Array(hex.length / 2)
	for (let i = 0; i < out.length; i++) {
		const hi = hexNibble(hex.charCodeAt(i * 2))
		const lo = hexNibble(hex.charCodeAt(i * 2 + 1))
		if (hi < 0 || lo < 0) {
			throw new Error(`hexToBytes: non-hex characters at offset ${i * 2}`)
		}
		out[i] = (hi << 4) | lo
	}
	return out
}

/* ── the schema's text form ───────────────────────────────────────────────────── */

// The schema stores keys, signatures and digests as TEXT, and the crypto layer works in raw
// bytes. The text form is **base64url**, because it is what the plugin's `digest` emits and
// what its `verify` decodes by default. Choosing anything else would mean passing encoding
// arguments to every `verify` in the schema -- and a call that forgot one would fail every
// signature while looking like a permissions problem.

/** Raw bytes in the schema's text form: base64url, unpadded. */
export function toText(bytes: Uint8Array): string {
	let binary = ''
	for (const b of bytes) binary += String.fromCharCode(b)
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * The schema's text form back to raw bytes. Throws on anything that is not **canonical**
 * base64url.
 *
 * Canonical is the load-bearing word. base64url's final character can carry unused padding
 * bits, so several strings decode to the same bytes -- flip one of those bits in a signature
 * and a lenient decoder still hands back the genuine signature. The stack's `verify`, which
 * the schema runs, refuses such a string. A decoder here that accepted it would have Taleus
 * believe a signature every replica rejects: the lift agent verifies a referee record before
 * acting on it, and would act on one the strand then refuses to finalize. So a string is
 * accepted only if encoding its bytes gives the same string back.
 */
export function fromText(text: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]*$/.test(text)) {
		throw new Error('not base64url text')
	}
	const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
	const out = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
	if (toText(out) !== text) {
		throw new Error('non-canonical base64url text')
	}
	return out
}

/** A public key in the schema's text form (base64url of the raw ed25519 key). */
export function publicKeyText(publicKey: Uint8Array): string {
	return toText(publicKey)
}

/* ── canonical digest ────────────────────────────────────────────────────────── */

/**
 * A value the schema's `digest()` receives: text, an integer count (`Units` is `bigint` here
 * for exactness; a `number` is accepted for small ints), or SQL NULL.
 */
export type DigestField = string | bigint | number | null

/**
 * The canonical digest, as raw bytes: the plugin's framed encoding, sha256. Field order is
 * load-bearing -- it is the schema's `digest(...)` argument order.
 */
export function digest(fields: DigestField[]): Uint8Array {
	for (const field of fields) {
		// The plugin would encode a fraction as a REAL, which it documents as colliding with
		// an integer of equal value. Nothing a lift signs is fractional; a fraction is a bug.
		if (typeof field === 'number' && !Number.isInteger(field)) {
			throw new Error(`digest integer field is not an integer: ${field}`)
		}
	}
	return stackDigest(fields, 'sha256', 'bytes') as Uint8Array
}

/* ── the two lift digest forms ───────────────────────────────────────────────── */

/**
 * The per-edge lift terms both the issuer and the referee sign over. Field NAMES and
 * ORDER mirror the schema's `Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date,
 * Expiry)` exactly (`PendingLift.SignatureValid` / `Ledger.LiftFinalize`). Distinct from
 * `terms.ts`'s `LiftTerms` (the discovery `L`-intent terms) — this is the *settlement*
 * digest input, not the route-capacity advertisement.
 */
export interface LiftEdgeTerms {
	/** The tally CID (`TallyCore.Cid`) — per-strand, so each edge's digest is distinct. */
	cid: string
	/** The per-edge pledge id (`PendingLift.LiftId`, the strand's PK for this pledge). */
	liftId: string
	/** The agreed referee's public key text (`PendingLift.RefereeKey`). */
	refereeKey: string
	/** Pledging side on this edge. */
	issuer: 'S' | 'F'
	/** Edge amount in THIS tally's denomination smallest units (`PendingLift.Units`). */
	units: bigint
	/** Pledge date (`PendingLift.Date`). */
	date: string
	/** Pledge expiry (`PendingLift.Expiry`). */
	expiry: string
}

/** `Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry)` — issuer & referee-commit digest. */
export function liftTermsDigest(t: LiftEdgeTerms): Uint8Array {
	return digest([t.cid, t.liftId, t.refereeKey, t.issuer, t.units, t.date, t.expiry])
}

/** `Digest(Cid, LiftId, 'void')` — the DISTINCT referee-void digest. */
export function liftVoidDigest(cid: string, liftId: string): Uint8Array {
	return digest([cid, liftId, 'void'])
}

/* ── sign / verify at the text boundary (mirrors the schema's verify form) ──────── */

/** Sign the lift-terms digest with a raw secret key; returns the signature in text form. */
export function signLiftTerms(secretKey: Uint8Array, t: LiftEdgeTerms): string {
	return toText(sign(secretKey, liftTermsDigest(t)))
}

/**
 * Verify a text-form signature over the lift-terms digest against a text-form public key —
 * the exact check `Ledger.LiftFinalize` (referee key) and `PendingLift.SignatureValid`
 * (issuer key) perform. This is the "schema constraint form" the byte-parity test asserts.
 */
export function verifyLiftTerms(publicKey: string, t: LiftEdgeTerms, signature: string): boolean {
	return verifyText(publicKey, liftTermsDigest(t), signature)
}

/** Sign the DISTINCT void digest; returns the signature in text form. */
export function signLiftVoid(secretKey: Uint8Array, cid: string, liftId: string): string {
	return toText(sign(secretKey, liftVoidDigest(cid, liftId)))
}

/** Verify a text-form signature over the void digest — the check `LiftVoid.RefereeVoidValid` performs. */
export function verifyLiftVoid(publicKey: string, cid: string, liftId: string, signature: string): boolean {
	return verifyText(publicKey, liftVoidDigest(cid, liftId), signature)
}

/** A malformed key or signature is a failed check, not a crash -- as the schema's `verify` treats it. */
function verifyText(publicKey: string, digestBytes: Uint8Array, signature: string): boolean {
	try {
		return verify(fromText(publicKey), digestBytes, fromText(signature))
	} catch {
		return false
	}
}
