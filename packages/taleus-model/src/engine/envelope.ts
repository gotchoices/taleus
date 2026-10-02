/**
 * What a Taleus invitation token carries.
 *
 * The core's invitation ticket says *where* to join and proves the bearer may take the seat. It
 * says nothing about what is being offered -- and cannot, because credit terms are signed against
 * the tally's identity, which does not exist until the invitee has joined. But an invitee should
 * see the terms before deciding. So the model's token wraps the ticket together with the offer as
 * the inviter states it; the signed terms follow on the tally once both parties are seated, and
 * the invitee reviews them again, signed, before agreeing.
 *
 * Nothing in the envelope is trusted for anything but display. Every term that binds anyone is
 * signed on the tally later.
 */
import type { Amount, Instant, Unit } from '../types.js'

export interface Envelope {
	v: 1
	/** The core's invitation ticket: where to join, and the credential to take the seat. Opaque here. */
	ticket: { ref: string; encoded: string }
	inviter: { sid: string; disclosed: Record<string, string> }
	unit: Unit
	/** What the inviter will let the invitee owe them. */
	creditLimit: Amount
	noticeDays: number
	agreementId: string
	expires: Instant
	note?: string
}

const PREFIX = 'taleus:offer:'

export function encodeEnvelope(envelope: Envelope): string {
	return PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(envelope)))
}

export function decodeEnvelope(token: string): Envelope | undefined {
	if (!token.startsWith(PREFIX)) return undefined
	try {
		const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(token.slice(PREFIX.length)))) as Envelope
		return parsed.v === 1 && typeof parsed.ticket?.encoded === 'string' ? parsed : undefined
	} catch {
		return undefined
	}
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = ''
	for (const b of bytes) binary += String.fromCharCode(b)
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
	const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
	const out = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
	return out
}
