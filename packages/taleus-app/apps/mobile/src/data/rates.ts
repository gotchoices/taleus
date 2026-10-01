/** rates: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { RatesModel } from 'taleus-model/rates'
import { getModel, mockControls } from './config'

export * from 'taleus-model/rates'

export const readRates = (...args: Parameters<RatesModel['readRates']>): ReturnType<RatesModel['readRates']> =>
	getModel().rates.readRates(...args)
export const setRate = (...args: Parameters<RatesModel['setRate']>): ReturnType<RatesModel['setRate']> =>
	getModel().rates.setRate(...args)
export const clearRate = (...args: Parameters<RatesModel['clearRate']>): ReturnType<RatesModel['clearRate']> =>
	getModel().rates.clearRate(...args)

/** Forget this namespace's mock writes. Tests and scenario capture only. */
export function resetRates(): void {
	mockControls().reset('rates')
}
