import { useEffect, useState } from 'react'

import { readSettings } from '../data/settings'
import { setLocale } from '../i18n'
import { useTheme } from '../theme'
import { setUnitStyle } from '../util/amount'

/**
 * Stored preferences, applied before the app paints (story 42 step 7).
 *
 * The three that follow the party — language, display unit, how units are
 * written — and the one that belongs to this device: its appearance. They are
 * applied here rather than by the settings screen, because a party who set them
 * on another device has never opened that screen on this one.
 *
 * It gates the first paint. A party who chose "always dark" should not be shown
 * a light app for a frame and then corrected; on a real device the store is
 * synchronous and there is nothing to gate, and the mock resolves in a tick.
 */
export function useStoredPreferences(): boolean {
	const { setChoice } = useTheme()
	const [ready, setReady] = useState(false)

	useEffect(() => {
		let live = true
		void (async () => {
			try {
				const result = await readSettings()
				if (live && result.ok) {
					setLocale(result.value.locale)
					setUnitStyle(result.value.unitStyle)
					setChoice(result.value.appearance)
				}
			} finally {
				if (live) {
					// Unreadable preferences are not a reason to withhold the app: the
					// defaults are all sensible, which is what story 42's `empty` says.
					setReady(true)
				}
			}
		})()
		return () => {
			live = false
		}
	}, [setChoice])

	return ready
}
