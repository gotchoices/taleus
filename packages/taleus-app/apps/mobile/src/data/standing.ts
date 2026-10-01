/** standing: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { StandingModel } from 'taleus-model/standing'
import { getModel, mockControls } from './config'

export * from 'taleus-model/standing'

export const readStanding = (...args: Parameters<StandingModel['readStanding']>): ReturnType<StandingModel['readStanding']> =>
	getModel().standing.readStanding(...args)
export const publishStanding = (...args: Parameters<StandingModel['publishStanding']>): ReturnType<StandingModel['publishStanding']> =>
	getModel().standing.publishStanding(...args)
export const withdrawStanding = (...args: Parameters<StandingModel['withdrawStanding']>): ReturnType<StandingModel['withdrawStanding']> =>
	getModel().standing.withdrawStanding(...args)

/** Forget this namespace's mock writes. Tests and scenario capture only. */
export function resetStanding(): void {
	mockControls().reset('standing')
}
