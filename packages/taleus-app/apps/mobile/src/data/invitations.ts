/** invitations: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { InvitationsModel } from 'taleus-model/invitations'
import { getModel, mockControls } from './config'

export * from 'taleus-model/invitations'

export const listInvitations = (...args: Parameters<InvitationsModel['listInvitations']>): ReturnType<InvitationsModel['listInvitations']> =>
	getModel().invitations.listInvitations(...args)
export const listAgreements = (...args: Parameters<InvitationsModel['listAgreements']>): ReturnType<InvitationsModel['listAgreements']> =>
	getModel().invitations.listAgreements(...args)
export const createInvitation = (...args: Parameters<InvitationsModel['createInvitation']>): ReturnType<InvitationsModel['createInvitation']> =>
	getModel().invitations.createInvitation(...args)
export const readInvitation = (...args: Parameters<InvitationsModel['readInvitation']>): ReturnType<InvitationsModel['readInvitation']> =>
	getModel().invitations.readInvitation(...args)
export const respondToInvitation = (...args: Parameters<InvitationsModel['respondToInvitation']>): ReturnType<InvitationsModel['respondToInvitation']> =>
	getModel().invitations.respondToInvitation(...args)
export const answerTo = (...args: Parameters<InvitationsModel['answerTo']>): ReturnType<InvitationsModel['answerTo']> =>
	getModel().invitations.answerTo(...args)

/** Forget this namespace's mock writes. Tests and scenario capture only. */
export function resetInvitations(): void {
	mockControls().reset('invitations')
}
