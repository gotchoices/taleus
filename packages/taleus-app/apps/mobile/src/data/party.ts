/** party: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { PartyModel } from 'taleus-model/party'
import { getModel, mockControls } from './config'

export * from 'taleus-model/party'

export const readParty = (...args: Parameters<PartyModel['readParty']>): ReturnType<PartyModel['readParty']> =>
	getModel().party.readParty(...args)
export const createIdentity = (...args: Parameters<PartyModel['createIdentity']>): ReturnType<PartyModel['createIdentity']> =>
	getModel().party.createIdentity(...args)
export const setDisplayName = (...args: Parameters<PartyModel['setDisplayName']>): ReturnType<PartyModel['setDisplayName']> =>
	getModel().party.setDisplayName(...args)

/** Forget this namespace's mock writes. Tests and scenario capture only. */
export function resetParty(): void {
	mockControls().reset('party')
}
