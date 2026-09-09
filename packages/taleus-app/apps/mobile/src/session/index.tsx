import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Linking } from 'react-native'

import { readParty, type Party } from '../data/party'
import { useLoad } from '../hooks/useLoad'
import { applyLaunchParams, launchUrl, whenLinkArrives } from '../navigation/linking'

/**
 * Whether a party exists, and how to ask again.
 *
 * This is the app's root state: before first run completes there is no identity
 * (story 10), and every other screen assumes one. Keeping it here means the
 * navigator can gate on it and the onboarding screens can tell it they are done.
 */
interface Session {
	party: Party | null
	/**
	 * True only before the first answer. Reloading must NOT report this: the
	 * navigator hides behind a spinner while it is true, and unmounting the
	 * navigation container mid-navigation loses whichever link caused the
	 * reload — which made deep links work or not depending on timing.
	 */
	initialising: boolean
	reload(): void

}

const SessionContext = createContext<Session | undefined>(undefined)

export function SessionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
	// Launch parameters first: `?variant=` decides which fixtures answer, so
	// reading the party before applying it reads the wrong one.
	const load = useCallback(async () => {
		await applyLaunchParams()
		return readParty()
	}, [])
	const { state, value, reload } = useLoad(load)
	const [pending, setPending] = useState<string | undefined>()

	const onboarded = isOnboarded(value ?? null)

	// Hold every link that arrives, because a link can change which navigator is
	// mounted — `?variant=naming` puts the app into first run, `?variant=happy`
	// takes it out — and React Navigation resolves a URL against the tree that
	// was mounted when it arrived, not the one that replaces it.
	useEffect(() => {
		whenLinkArrives(url => setPending(url))
	}, [])

	// When the gate flips, deliver that link again so it lands in the tree that
	// now exists. Either direction: into first run, or out of it.
	const wasOnboarded = useRef<boolean | undefined>(undefined)
	useEffect(() => {
		if (wasOnboarded.current === undefined) {
			wasOnboarded.current = onboarded
			return
		}
		if (wasOnboarded.current === onboarded) {
			return
		}
		wasOnboarded.current = onboarded
		const url = pending ?? launchUrl()
		if (!url) {
			return
		}
		setPending(undefined)
		void Linking.openURL(url).catch(() => undefined)
	}, [onboarded, pending])

	const session = useMemo<Session>(
		() => ({
			party: value ?? null,
			initialising: state === 'loading' && value === undefined,
			reload,
		}),
		[value, state, reload],
	)

	return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
	const session = useContext(SessionContext)
	if (!session) {
		throw new Error('useSession outside SessionProvider')
	}
	return session
}

/** First run is complete once there is an identity with a name on it. */
export function isOnboarded(party: Party | null): boolean {
	return Boolean(party && party.displayName)
}
