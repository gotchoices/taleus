/** publishers: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { PublishersModel } from 'taleus-model/publishers'
import { getModel, mockControls } from './config'

export * from 'taleus-model/publishers'
export { BUILT_IN_PUBLISHER, type AgreementStanding } from 'taleus-model/agreement'

export const listTrusted = (...args: Parameters<PublishersModel['listTrusted']>): ReturnType<PublishersModel['listTrusted']> =>
	getModel().publishers.listTrusted(...args)
export const trustPublisher = (...args: Parameters<PublishersModel['trustPublisher']>): ReturnType<PublishersModel['trustPublisher']> =>
	getModel().publishers.trustPublisher(...args)
export const untrustPublisher = (...args: Parameters<PublishersModel['untrustPublisher']>): ReturnType<PublishersModel['untrustPublisher']> =>
	getModel().publishers.untrustPublisher(...args)
export const trustAgreement = (...args: Parameters<PublishersModel['trustAgreement']>): ReturnType<PublishersModel['trustAgreement']> =>
	getModel().publishers.trustAgreement(...args)

/** Forget this namespace's mock writes. Tests and scenario capture only. */
export function resetPublishers(): void {
	mockControls().reset('publishers')
}
