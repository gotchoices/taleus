/**
 * The one place that defines Taleus's invitation link: `https://sereus.org/taleus/invite/#<token>`.
 *
 * With the app installed, the phone hands the link to the app and the server is never asked. Without
 * it, the browser loads the static page at `/taleus/invite/` (`web/invite/index.html`), which reads the
 * token in the browser and offers the app.
 *
 * THE TOKEN GOES AFTER `#`. An invitation is a bearer credential -- it carries the secret to the open
 * seat -- and a fragment is never sent to the server, so it never reaches an access log. A path or a
 * query would be. App Links and Universal Links match on host and path and ignore the fragment, so
 * the claimed `/taleus/invite/` path still opens the app. The same shape sereus-chat uses.
 *
 * Links handed out earlier in the path form, `/taleus/invite/<token>`, still open.
 */
export const INVITE_URL = 'https://sereus.org/taleus/invite/'

export function buildInviteLink(token: string): string {
	return `${INVITE_URL}#${token}`
}

/**
 * The token in an invitation link, or undefined if the text is not one: the fragment form, or the
 * earlier path form.
 */
export function inviteToken(link: string): string | undefined {
	const text = link.trim()
	if (!text.startsWith(INVITE_URL)) return undefined
	const rest = text.slice(INVITE_URL.length)
	const token = rest.startsWith('#') ? rest.slice(1) : rest.split(/[?#]/)[0]
	return token ? decodeURIComponent(token) : undefined
}

/**
 * The link as navigation routes it. Navigation matches paths and drops fragments, so the fragment
 * form becomes the path form `ReviewInvitation` is reached by; anything else passes unchanged.
 */
export function routableLink(url: string): string {
	const token = url.startsWith(`${INVITE_URL}#`) ? inviteToken(url) : undefined
	return token ? `${INVITE_URL}${encodeURIComponent(token)}` : url
}
