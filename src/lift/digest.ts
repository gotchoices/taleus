/**
 * The **cross-primitive digest contract** for lift commit (see docs/architecture.md
 * § Referee model and the commit seam, "Cross-primitive constraint"). This is the
 * make-or-break of `feat-lift-referee-commit`: the per-edge digest the referee signs
 * here MUST be byte-identical to what the Quereus schema's `Digest()` scalar
 * recomputes, so that a referee signature verifies under the schema's
 * `SignatureValid()` (`Ledger.LiftFinalize` / `LiftVoid.RefereeVoidValid` in
 * schema/draft1.qsql). A one-byte divergence means every finalize silently fails to
 * settle.
 *
 * Two digest forms are used, both defined by the landed schema:
 *   - lift-terms digest — `Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry)`,
 *     signed by the issuer (`PendingLift.SignatureValid`) AND by the referee at commit
 *     (`Ledger.LiftFinalize`). Identical field order and bytes for both signatures — the
 *     issuer pledge and the referee commit are two signatures over the *same* digest,
 *     verified against different keys.
 *   - void digest — `Digest(Cid, LiftId, 'void')` (`LiftVoid.RefereeVoidValid`).
 *     Deliberately DISTINCT from the lift-terms digest, so a commit signature can never
 *     be replayed as a void or vice versa.
 *
 * ── The canonical field encoding (this file DEFINES the contract) ──────────────
 * NOTE: `Digest()` is a HOST-REGISTERED Quereus scalar (schema/draft1.qsql calls it
 * like `ValidDate`/`SignatureValid`); the runner that registers it does not exist yet
 * (the feat-schema-lift-chits review stubbed it to bind the schema). So there is no
 * pre-existing byte layout to match — this module ESTABLISHES it, exactly as
 * src/transport/chipnet-protocol.ts `computeNonce` established the nonce layout. The
 * encoding is deliberately unambiguous (type tag + u32be length prefix per field, then
 * sha256), so no field-boundary or cross-type collision is possible — a bare delimiter
 * would let `("12","3")` collide with `("1","23")`, and untagged text/int would let the
 * integer 123 collide with the text "123". When the runner's `Digest()` lands it MUST
 * implement this same layout (or this must be updated in lockstep); the digest.test.ts
 * byte-parity + known-answer vectors pin it so a drift is caught, not shipped silently.
 */

import { sha256, sign, verify } from '../crypto/index.js'

/* ── hex codec for the text key/signature boundary ───────────────────────────── */

// The schema stores public keys and signatures as TEXT (`RefereeKey`, `Signature`,
// `RefereeSignature` are text columns); the crypto layer works in raw bytes. Hex is the
// text encoding at that boundary — unambiguous, trivially reversible, case-normalized.

const HEX = '0123456789abcdef'

/** Encode raw bytes as lowercase hex text (the schema's key/signature text form). */
export function bytesToHex(bytes: Uint8Array): string {
	let out = ''
	for (const b of bytes) {
		out += HEX[b >> 4] + HEX[b & 0x0f]
	}
	return out
}

/** Decode lowercase/uppercase hex text back to raw bytes. Rejects malformed input. */
export function hexToBytes(hex: string): Uint8Array {
	if (hex.length % 2 !== 0) {
		throw new Error(`hexToBytes: odd-length hex string (${hex.length})`)
	}
	const out = new Uint8Array(hex.length / 2)
	for (let i = 0; i < out.length; i++) {
		const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
		if (Number.isNaN(byte)) {
			throw new Error(`hexToBytes: non-hex characters at offset ${i * 2}`)
		}
		out[i] = byte
	}
	return out
}

/** A public key in the schema's text form (hex of the raw ed25519 key). */
export function publicKeyText(publicKey: Uint8Array): string {
	return bytesToHex(publicKey)
}

/* ── canonical digest ────────────────────────────────────────────────────────── */

/**
 * A value the schema's `Digest()` scalar receives: text, an integer count (`Units` is
 * `bigint` here for exactness; a `number` is accepted for small ints), or SQL NULL.
 * The lift digests use no NULL fields, but the encoding tags NULL so the contract is
 * total.
 */
export type DigestField = string | bigint | number | null

const enc = new TextEncoder()

/** Type-tag + u32be-length + utf8 bytes for one field (the collision-proof unit). */
function encodeField(field: DigestField): Uint8Array {
	let tag: number
	let body: Uint8Array
	if (field === null) {
		tag = 0x6e // 'n' — SQL NULL
		body = new Uint8Array(0)
	} else if (typeof field === 'string') {
		tag = 0x74 // 't' — text
		body = enc.encode(field)
	} else {
		tag = 0x69 // 'i' — integer, canonical decimal ASCII (sign-preserving, no leading zeros)
		if (typeof field === 'number' && !Number.isInteger(field)) {
			throw new Error(`digest integer field is not an integer: ${field}`)
		}
		body = enc.encode(BigInt(field).toString())
	}
	const out = new Uint8Array(1 + 4 + body.length)
	out[0] = tag
	new DataView(out.buffer).setUint32(1, body.length, false)
	out.set(body, 5)
	return out
}

/**
 * The canonical digest: `sha256( ‖ encodeField(f) for f in fields )`. Field order is
 * load-bearing — it is the schema's `Digest(...)` argument order — and every field is
 * length- and type-prefixed so no two distinct field lists can ever produce the same
 * byte stream.
 */
export function digest(fields: DigestField[]): Uint8Array {
	const parts = fields.map(encodeField)
	const total = parts.reduce((n, p) => n + p.length, 0)
	const buf = new Uint8Array(total)
	let offset = 0
	for (const p of parts) {
		buf.set(p, offset)
		offset += p.length
	}
	return sha256(buf)
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

/* ── sign / verify at the text boundary (mirrors the schema's SignatureValid form) ── */

/** Sign the lift-terms digest with a raw secret key; returns the hex text signature. */
export function signLiftTerms(secretKey: Uint8Array, t: LiftEdgeTerms): string {
	return bytesToHex(sign(secretKey, liftTermsDigest(t)))
}

/**
 * Verify a hex text signature over the lift-terms digest against a hex text public key —
 * the exact check `Ledger.LiftFinalize` (referee key) and `PendingLift.SignatureValid`
 * (issuer key) perform. This is the "schema constraint form" the byte-parity test asserts.
 */
export function verifyLiftTerms(publicKeyHex: string, t: LiftEdgeTerms, signatureHex: string): boolean {
	return verify(hexToBytes(publicKeyHex), liftTermsDigest(t), hexToBytes(signatureHex))
}

/** Sign the DISTINCT void digest; returns the hex text signature. */
export function signLiftVoid(secretKey: Uint8Array, cid: string, liftId: string): string {
	return bytesToHex(sign(secretKey, liftVoidDigest(cid, liftId)))
}

/** Verify a hex text signature over the void digest — the check `LiftVoid.RefereeVoidValid` performs. */
export function verifyLiftVoid(publicKeyHex: string, cid: string, liftId: string, signatureHex: string): boolean {
	return verify(hexToBytes(publicKeyHex), liftVoidDigest(cid, liftId), hexToBytes(signatureHex))
}
