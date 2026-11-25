/**
 * Edge nonces: the only reference to a tally that travels on the wire during a lift. A nonce is
 * `base64url(sha256(sessionCode ‖ linkId))`, salted by the per-session code so an intermediary
 * sees a different hash for the same tally each session and cannot correlate it across sessions.
 * Only the edge's owner holds the `linkId`, so only it can map a nonce back to a real tally.
 *
 * The `sessionCode ‖ linkId` preimage is **length-prefixed**, not merely concatenated: four
 * big-endian bytes giving the session code's UTF-8 length, then the session code, then the link id.
 * A bare delimiter would let ("a","bc") and ("ab","c") collide, and a nonce collision would let a
 * peer conflate two distinct tallies. Since both ends of a tally run this same function, they agree
 * on the nonce without exchanging it.
 *
 * Preimage parity with `taleus-core`: the byte layout here is identical to `computeNonce` in
 * `packages/taleus-core/src/transport/chipnet-protocol.ts`. The **text encoding differs** —
 * TallyNet emits base64url (URL/filename-safe), `taleus-core`'s current `computeNonce` emits
 * standard padded base64. The binding ticket (`feat-tallynet-bind-taleus-core`) unifies them by having
 * the transport import this function; until then the two must not be compared as strings.
 */

import { nobleHasher, type Hasher } from './crypto.js'
import { bytesToBase64url } from './base64url.js'

/** Derive the per-session nonce for an edge. `hasher` defaults to sha256 from `@noble/hashes`. */
export function makeNonce(sessionCode: string, linkId: string, hasher: Hasher = nobleHasher): string {
	const enc = new TextEncoder()
	const session = enc.encode(sessionCode)
	const link = enc.encode(linkId)
	const buf = new Uint8Array(4 + session.length + link.length)
	new DataView(buf.buffer).setUint32(0, session.length, false)
	buf.set(session, 4)
	buf.set(link, 4 + session.length)
	return bytesToBase64url(hasher.sha256(buf))
}
