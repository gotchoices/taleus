import { Linking } from 'react-native'
import type { LinkingOptions } from '@react-navigation/native'

import { setLocale } from '../i18n'
import { setVariant, variantFromUrl } from '../mock/variant'
import type { TabParams } from './routes'

/**
 * Deep links and universal links, per `design/specs/mobile/navigation.md`.
 *
 * `taleus://screen/<Route>[/<id>]` is the internal and scenario-capture form;
 * `https://sereus.org/taleus/invite/<token>` is the universal link.
 *
 * `getInitialURL` and `subscribe` are overridden only so the non-navigation
 * parameters — `variant`, `locale` — are applied *before* a screen mounts and
 * asks for data. Doing it in an effect would race the first load.
 */
export const linking: LinkingOptions<TabParams> = {
	prefixes: ['taleus://', 'https://sereus.org'],
	config: {
		screens: {
			Tallies: {
				// A link straight to a tally lands with the list beneath it, so back
				// goes somewhere sensible rather than out of the app.
				initialRouteName: 'TallyList',
				screens: {
					TallyList: 'screen/TallyList',
					TallyView: 'screen/TallyView/:tallyId',
					TallyHistory: 'screen/TallyHistory/:tallyId',
				},
			},
			AttentionTab: { screens: { Attention: 'screen/Attention' } },
			PositionTab: { screens: { Position: 'screen/Position' } },
		},
	},
	getInitialURL: applyLaunchParams,
	subscribe(listener) {
		const sub = Linking.addEventListener('url', ({ url }) => {
			consume(url)
			listener(url)
		})
		return () => sub.remove()
	},
}

/**
 * The launch URL, read and applied once.
 *
 * This has to happen *before* anything reads data, because `?variant=` decides
 * which fixtures answer. The navigation container asks for the initial URL only
 * after it mounts, by which time the session has already read the party — so the
 * session applies the launch parameters first and the container reuses the
 * result.
 */
let launched: string | null | undefined

export async function applyLaunchParams(): Promise<string | null> {
	if (launched === undefined) {
		launched = consume((await Linking.getInitialURL()) ?? null)
	}
	return launched
}

/** The launch URL, once `applyLaunchParams` has run. */
export function launchUrl(): string | null {
	return launched ?? null
}

/** Applies the parameters that are not navigation, and returns the URL unchanged. */
function consume(url: string | null): string | null {
	if (!url) {
		return url
	}
	const variant = variantFromUrl(url)
	if (variant) {
		setVariant(variant)
	}
	const locale = /[?&]locale=([^&]+)/.exec(url)
	if (locale) {
		setLocale(decodeURIComponent(locale[1]))
	}
	return url
}
