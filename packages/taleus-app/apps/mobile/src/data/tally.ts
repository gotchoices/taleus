/** tally: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { TallyModel } from 'taleus-model/tally'
import { getModel, mockControls } from './config'

export * from 'taleus-model/tally'

export const readTally = (...args: Parameters<TallyModel['readTally']>): ReturnType<TallyModel['readTally']> =>
	getModel().tally.readTally(...args)
export const readTerms = (...args: Parameters<TallyModel['readTerms']>): ReturnType<TallyModel['readTerms']> =>
	getModel().tally.readTerms(...args)
export const readAgreement = (...args: Parameters<TallyModel['readAgreement']>): ReturnType<TallyModel['readAgreement']> =>
	getModel().tally.readAgreement(...args)
export const requestClose = (...args: Parameters<TallyModel['requestClose']>): ReturnType<TallyModel['requestClose']> =>
	getModel().tally.requestClose(...args)
export const withdrawClose = (...args: Parameters<TallyModel['withdrawClose']>): ReturnType<TallyModel['withdrawClose']> =>
	getModel().tally.withdrawClose(...args)

/** Forget this namespace's mock writes. Tests and scenario capture only. */
export function resetCloses(): void {
	mockControls().reset('tally')
}
