/** requests: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { RequestsModel } from 'taleus-model/requests'
import { getModel, mockControls } from './config'

export * from 'taleus-model/requests'

export const listRequests = (...args: Parameters<RequestsModel['listRequests']>): ReturnType<RequestsModel['listRequests']> =>
	getModel().requests.listRequests(...args)
export const createRequest = (...args: Parameters<RequestsModel['createRequest']>): ReturnType<RequestsModel['createRequest']> =>
	getModel().requests.createRequest(...args)
export const readRequest = (...args: Parameters<RequestsModel['readRequest']>): ReturnType<RequestsModel['readRequest']> =>
	getModel().requests.readRequest(...args)
export const declineRequest = (...args: Parameters<RequestsModel['declineRequest']>): ReturnType<RequestsModel['declineRequest']> =>
	getModel().requests.declineRequest(...args)
export const withdrawRequest = (...args: Parameters<RequestsModel['withdrawRequest']>): ReturnType<RequestsModel['withdrawRequest']> =>
	getModel().requests.withdrawRequest(...args)
export const applyToRequest = (...args: Parameters<RequestsModel['applyToRequest']>): ReturnType<RequestsModel['applyToRequest']> =>
	getModel().requests.applyToRequest(...args)

/** Forget this namespace's mock writes. Tests and scenario capture only. */
export function resetRequests(): void {
	mockControls().reset('requests')
}
