import { Linking } from 'react-native'
import type { LinkingOptions } from '@react-navigation/native'

import { setLocale } from '../i18n'
import { setVariant, variantFromUrl } from '../mock/variant'
import type { OnboardingParams, TabParams } from './routes'

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
export const linking: LinkingOptions<TabParams & OnboardingParams> = {
	prefixes: ['taleus://', 'https://sereus.org'],
	config: {
		screens: {
			// First run is a real destination, not just a state the gate falls into.
			// Without these, a link to an onboarding screen matched nothing and the
			// party landed on whatever the stack's initial route happened to be.
			Welcome: 'screen/Welcome',
			ChooseName: 'screen/ChooseName',
			Tallies: {
				// A link straight to a tally lands with the list beneath it, so back
				// goes somewhere sensible rather than out of the app.
				initialRouteName: 'TallyList',
				screens: {
					TallyList: 'screen/TallyList',
					TallyView: 'screen/TallyView/:tallyId',
					TallyHistory: 'screen/TallyHistory/:tallyId',
					CreateInvitation: 'screen/CreateInvitation',
					ReviewOffer: 'screen/ReviewOffer/:tallyId',
					// Two ways in: the scenario/deep-link form, and the universal link
					// a person is actually sent (`navigation.md` § Deep Links).
					ReviewInvitation: {
						path: 'screen/ReviewInvitation/:token',
						alias: ['/taleus/invite/:token'],
					},
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
			arriving?.(url)
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

/**
 * Every link that arrives while running, after its parameters are applied.
 *
 * The session needs this because a link can change who the party is — the mock
 * variant decides whether an identity exists — and a link that arrives during
 * first run has nowhere to land until first run is over.
 */
let arriving: ((url: string) => void) | undefined

export function whenLinkArrives(handler: (url: string) => void): void {
	arriving = handler
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
