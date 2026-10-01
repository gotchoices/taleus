/** profile: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { ProfileModel } from 'taleus-model/profile'
import { getModel, mockControls } from './config'

export * from 'taleus-model/profile'

export const readProfile = (...args: Parameters<ProfileModel['readProfile']>): ReturnType<ProfileModel['readProfile']> =>
	getModel().profile.readProfile(...args)
export const setField = (...args: Parameters<ProfileModel['setField']>): ReturnType<ProfileModel['setField']> =>
	getModel().profile.setField(...args)
export const authorizeCorrection = (...args: Parameters<ProfileModel['authorizeCorrection']>): ReturnType<ProfileModel['authorizeCorrection']> =>
	getModel().profile.authorizeCorrection(...args)
export const discloseMore = (...args: Parameters<ProfileModel['discloseMore']>): ReturnType<ProfileModel['discloseMore']> =>
	getModel().profile.discloseMore(...args)
export const askFor = (...args: Parameters<ProfileModel['askFor']>): ReturnType<ProfileModel['askFor']> =>
	getModel().profile.askFor(...args)
export const answerRequest = (...args: Parameters<ProfileModel['answerRequest']>): ReturnType<ProfileModel['answerRequest']> =>
	getModel().profile.answerRequest(...args)

/** Forget this namespace's mock writes. Tests and scenario capture only. */
export function resetProfile(): void {
	mockControls().reset('profile')
}
