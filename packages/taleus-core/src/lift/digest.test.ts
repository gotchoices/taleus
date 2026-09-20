import { generateKeyPair, sign, verify } from '../crypto/index.js'
import {
	bytesToHex,
	digest,
	hexToBytes,
	liftTermsDigest,
	liftVoidDigest,
	publicKeyText,
	signLiftTerms,
	signLiftVoid,
	verifyLiftTerms,
	verifyLiftVoid,
	type LiftEdgeTerms,
} from './digest.js'

const terms: LiftEdgeTerms = {
	cid: 'tally-cid-1',
	liftId: 'L1',
	refereeKey: 'referee-key',
	issuer: 'F',
	units: 1500n,
	date: '2026-07-13',
	expiry: '2026-07-20',
}

describe('canonical digest', () => {
	it('is deterministic for the same field list', () => {
		expect(bytesToHex(digest(['a', 1n, 'b']))).toBe(bytesToHex(digest(['a', 1n, 'b'])))
	})

	it('is field-order sensitive (order is the schema Digest() argument order)', () => {
		expect(bytesToHex(digest(['a', 'b']))).not.toBe(bytesToHex(digest(['b', 'a'])))
	})

	it('cannot collide across field boundaries (length prefix)', () => {
		// A bare delimiter would let ("12","3") collide with ("1","23"); the u32be length prefix forbids it.
		expect(bytesToHex(digest(['12', '3']))).not.toBe(bytesToHex(digest(['1', '23'])))
	})

	it('cannot collide across types (integer 123 vs text "123")', () => {
		expect(bytesToHex(digest([123n]))).not.toBe(bytesToHex(digest(['123'])))
	})

	it('treats bigint and equal number integers identically', () => {
		expect(bytesToHex(digest([123]))).toBe(bytesToHex(digest([123n])))
	})

	it('rejects a non-integer number field', () => {
		expect(() => digest([1.5])).toThrow(/not an integer/)
	})
})

describe('hex codec', () => {
	it('round-trips arbitrary bytes', () => {
		const bytes = new Uint8Array([0x00, 0x0f, 0xa5, 0xff, 0x10])
		expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes)
	})

	it('rejects odd-length and non-hex input', () => {
		expect(() => hexToBytes('abc')).toThrow(/odd-length/)
		expect(() => hexToBytes('zz')).toThrow(/non-hex/)
	})

	it('rejects a valid leading nibble followed by junk (parseInt prefix-parse laxness)', () => {
		// Number.parseInt('0g',16) === 0 and parseInt(' a',16) === 10 — a naive decoder would
		// silently accept these. Per-nibble validation must reject them.
		expect(() => hexToBytes('0g')).toThrow(/non-hex/)
		expect(() => hexToBytes('a!')).toThrow(/non-hex/)
		expect(() => hexToBytes(' a')).toThrow(/non-hex/)
	})
})

describe('lift-terms digest byte-parity with the schema constraint form', () => {
	// The make-or-break: the digest the referee signs here must be byte-identical to what the
	// schema's Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry) recomputes.
	it('equals an explicit schema-order field digest', () => {
		const schemaForm = digest([terms.cid, terms.liftId, terms.refereeKey, terms.issuer, terms.units, terms.date, terms.expiry])
		expect(bytesToHex(liftTermsDigest(terms))).toBe(bytesToHex(schemaForm))
	})

	it('a referee signature verifies against the schema constraint form (Ledger.LiftFinalize)', () => {
		const { publicKey, secretKey } = generateKeyPair()
		const refKey = publicKeyText(publicKey)
		const t = { ...terms, refereeKey: refKey }
		// Referee signs the lift-terms digest; the schema's LiftFinalize recomputes it and verifies.
		const refereeSig = signLiftTerms(secretKey, t)
		expect(verifyLiftTerms(refKey, t, refereeSig)).toBe(true)
	})

	it('the issuer pledge signature and the referee commit signature are over the SAME digest', () => {
		// PendingLift.SignatureValid (issuer key) and Ledger.LiftFinalize (referee key) verify the
		// identical digest — two signatures, one digest, different keys.
		const issuer = generateKeyPair()
		const refereeKp = generateKeyPair()
		const refKey = publicKeyText(refereeKp.publicKey)
		const t = { ...terms, refereeKey: refKey }
		const issuerSig = signLiftTerms(issuer.secretKey, t)
		const refereeSig = signLiftTerms(refereeKp.secretKey, t)
		expect(verifyLiftTerms(publicKeyText(issuer.publicKey), t, issuerSig)).toBe(true)
		expect(verifyLiftTerms(refKey, t, refereeSig)).toBe(true)
	})

	it('a signature over a permuted field order does NOT verify (drift is caught)', () => {
		const { publicKey, secretKey } = generateKeyPair()
		const refKey = publicKeyText(publicKey)
		const t = { ...terms, refereeKey: refKey }
		// Sign a wrong-order digest (Issuer/Units swapped) and confirm the schema form rejects it.
		const wrong = digest([t.cid, t.liftId, t.refereeKey, t.units, t.issuer, t.date, t.expiry])
		const badSig = bytesToHex(sign(secretKey, wrong))
		expect(verifyLiftTerms(refKey, t, badSig)).toBe(false)
	})
})

describe('void digest is distinct from the commit digest (no cross-replay)', () => {
	it('a commit signature does not verify as a void, and vice versa', () => {
		const { publicKey, secretKey } = generateKeyPair()
		const refKey = publicKeyText(publicKey)
		const t = { ...terms, refereeKey: refKey }
		const commitSig = signLiftTerms(secretKey, t)
		const voidSig = signLiftVoid(secretKey, t.cid, t.liftId)

		// Commit signature cannot satisfy the void check…
		expect(verifyLiftVoid(refKey, t.cid, t.liftId, commitSig)).toBe(false)
		// …and the void signature cannot satisfy the finalize check.
		expect(verifyLiftTerms(refKey, t, voidSig)).toBe(false)
		// Each verifies against its own form.
		expect(verify(publicKey, liftTermsDigest(t), hexToBytes(commitSig))).toBe(true)
		expect(verify(publicKey, liftVoidDigest(t.cid, t.liftId), hexToBytes(voidSig))).toBe(true)
	})
})
