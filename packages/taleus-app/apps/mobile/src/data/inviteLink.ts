/**
 * The invitation link as this app's navigation needs it. The link itself is defined once, in
 * `taleus-model` (`buildInviteLink`, `inviteToken`), for every Taleus app.
 */
import { INVITE_URL, inviteToken } from 'taleus-model'

export { buildInviteLink, INVITE_URL, inviteToken } from 'taleus-model'

/**
 * The link as navigation routes it. Navigation matches paths and drops fragments, so the fragment
 * form becomes the path form `ReviewInvitation` is reached by; anything else passes unchanged.
 */
export function routableLink(url: string): string {
	const token = url.startsWith(`${INVITE_URL}#`) ? inviteToken(url) : undefined
	return token ? `${INVITE_URL}${encodeURIComponent(token)}` : url
}
