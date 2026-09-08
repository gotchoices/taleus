import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { Linking } from 'react-native'

import { readParty, type Party } from '../data/party'
import { useLoad } from '../hooks/useLoad'
import { applyLaunchParams, launchUrl } from '../navigation/linking'

/**
 * Whether a party exists, and how to ask again.
 *
 * This is the app's root state: before first run completes there is no identity
 * (story 10), and every other screen assumes one. Keeping it here means the
 * navigator can gate on it and the onboarding screens can tell it they are done.
 */
interface Session {
	party: Party | null
	loading: boolean
	reload(): void
	/**
	 * Re-deliver the link the app was launched by. Story 10 path A: setting up
	 * happens on the way to answering, and the party lands on the invitation
	 * rather than on an empty app.
	 */
	resume(): void
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
	const [resumed, setResumed] = useState(false)

	const session = useMemo<Session>(
		() => ({
			party: value ?? null,
			loading: state === 'loading',
			reload,
			resume: () => {
				const url = launchUrl()
				if (resumed || !url) {
					return
				}
				setResumed(true)
				// Re-delivering the URL is what gets the party to the destination:
				// the container consumed it at mount, when the onboarding stack was
				// showing and nothing matched.
				void Linking.openURL(url).catch(() => undefined)
			},
		}),
		[value, state, reload, resumed],
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
