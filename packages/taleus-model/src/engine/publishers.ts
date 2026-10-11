import { isDomain } from '@stroc/core'
import { BUILT_IN_PUBLISHER, type TrustedPublisher } from '../agreement.js'
import type { PublishersModel } from '../publishers.js'
import type { Session } from './session.js'
import { failed, ok } from './translate.js'

/** Story 08: the publishers this party trusts, kept in the device's local state. */
export function publishersModel(session: Session): PublishersModel {
	const list = (): TrustedPublisher[] => [
		{ domain: BUILT_IN_PUBLISHER, builtIn: true },
		...session.local.trustedPublishers.map(({ domain, since }) => ({ domain, builtIn: false, since })),
	]

	return {
		async listTrusted() {
			return ok(list())
		},

		async trustPublisher(domain) {
			const name = domain.trim().toLowerCase()
			if (!isDomain(name)) return failed<TrustedPublisher[]>('invalid', `${domain} is not a domain name`)
			if (name !== BUILT_IN_PUBLISHER && !session.local.trustedPublishers.some(p => p.domain === name)) {
				session.local.trustedPublishers.push({ domain: name, since: session.today() })
				session.changed()
			}
			return ok(list())
		},

		async untrustPublisher(domain) {
			if (domain === BUILT_IN_PUBLISHER) return failed<TrustedPublisher[]>('built-in', `${BUILT_IN_PUBLISHER} makes Taleus and is always trusted`)
			session.local.trustedPublishers = session.local.trustedPublishers.filter(p => p.domain !== domain)
			session.changed()
			return ok(list())
		},

		async trustAgreement(agreementId) {
			if (!session.local.trustedAgreements.includes(agreementId)) {
				session.local.trustedAgreements.push(agreementId)
				session.changed()
			}
			return ok(undefined)
		},
	}
}
