/**
 * base64url (RFC 4648 §5), unpadded, over raw bytes. The on-wire text form for everything
 * TallyNet emits -- session codes and nonces -- chosen over standard base64 because the
 * result is URL- and filename-safe (`-`/`_` instead of `+`/`/`, no `=` padding).
 *
 * Built on `btoa`/`atob`, which every target provides (browsers, Node ≥ 16, Hermes), rather
 * than `Buffer`, so the module stays platform-neutral (see docs/design.md § Scope and
 * boundaries). Matches the encoding `taleus-core`'s `digest.ts` uses for the schema's text form.
 */

/** Raw bytes → unpadded base64url text. */
export function bytesToBase64url(bytes: Uint8Array): string {
	let binary = ''
	for (const b of bytes) {
		binary += String.fromCharCode(b)
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Unpadded base64url text → raw bytes. Throws on anything that is not **canonical** base64url:
 * a non-alphabet character, or trailing bits that a strict re-encode would not reproduce.
 *
 * Canonicality matters because these strings arrive from peers. base64url's final character can
 * carry unused padding bits, so several strings decode to the same bytes; a lenient decoder would
 * let a peer present two distinct-looking session codes or nonces that collide. A string is
 * accepted only if re-encoding its bytes yields the same string back (as `taleus-core`'s
 * `fromText` does).
 */
export function base64urlToBytes(text: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]*$/.test(text)) {
		throw new Error('base64urlToBytes: not base64url text')
	}
	const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
	const out = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		out[i] = binary.charCodeAt(i)
	}
	if (bytesToBase64url(out) !== text) {
		throw new Error('base64urlToBytes: non-canonical base64url text')
	}
	return out
}
