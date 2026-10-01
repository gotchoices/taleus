/** offers: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { OffersModel } from 'taleus-model/offers'
import { getModel, mockControls } from './config'

export * from 'taleus-model/offers'

export const readOffer = (...args: Parameters<OffersModel['readOffer']>): ReturnType<OffersModel['readOffer']> =>
	getModel().offers.readOffer(...args)
export const respondToOffer = (...args: Parameters<OffersModel['respondToOffer']>): ReturnType<OffersModel['respondToOffer']> =>
	getModel().offers.respondToOffer(...args)

/** Forget this namespace's mock writes. Tests and scenario capture only. */
export function resetOffers(): void {
	mockControls().reset('offers')
}
