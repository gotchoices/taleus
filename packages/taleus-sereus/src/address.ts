/**
 * A tally strand's invitation, as it travels inside a Taleus invitation token (`TallyRef.address`).
 *
 * Sereus encodes an open invitation as base64url JSON; Taleus then wraps that in its own envelope and
 * encodes again, so the same bytes paid base64 twice and every address of the inviter came along.
 * An invitation is often handed over as a QR code, where every character costs, so here it is plain
 * JSON -- the envelope's own encoding is the only one -- with the sApp implied by the store that reads
 * it, and only the addresses a phone can dial.
 */
import { multiaddr } from '@multiformats/multiaddr'
import type { OpenInvitation } from '@serfab/cadre-core'

interface StrandAddress {
	/** The formation token. */
	t: string
	/** When the strand invitation lapses (ISO). */
	e: string
	/** The inviter's addresses an invitee can dial. */
	b: string[]
}

export function encodeStrandAddress(invitation: OpenInvitation): string {
	const address: StrandAddress = {
		t: invitation.token,
		e: invitation.expiration.toISOString(),
		b: dialable(invitation.bootstrap),
	}
	return JSON.stringify(address)
}

export function decodeStrandAddress(text: string, sAppId: string): OpenInvitation {
	const address = JSON.parse(text) as Partial<StrandAddress>
	if (typeof address.t !== 'string' || typeof address.e !== 'string' || !Array.isArray(address.b)) {
		throw new Error('the invitation carries no readable strand address')
	}
	return { token: address.t, sAppId, expiration: new Date(address.e), bootstrap: address.b }
}

/**
 * The addresses worth carrying: those over WebSockets, which every phone can dial (its only
 * transport) and every Sereus node listens on. A relay reached over plain TCP as well appears twice
 * otherwise, once per transport, for no invitee that could use only the second. If there is no
 * WebSocket address at all, all of them are kept rather than none.
 */
function dialable(addresses: readonly string[]): string[] {
	const overWebSockets = addresses.filter(address => {
		try {
			return multiaddr(address)
				.getComponents()
				.some(component => component.name === 'ws' || component.name === 'wss')
		} catch {
			return false
		}
	})
	return overWebSockets.length > 0 ? overWebSockets : [...addresses]
}
