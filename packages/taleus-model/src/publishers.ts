import type { TrustedPublisher } from './agreement.js'
import type { Result } from './types.js'

export type { TrustedPublisher } from './agreement.js'

/**
 * Story 08: the publishers this party trusts. Kept for the party as it decides on agreements -- most
 * often when accepting one from a publisher it has not met -- and also viewable and editable.
 */
export interface PublishersModel {
	/** The trusted publishers, sereus.org first. */
	listTrusted(): Promise<Result<TrustedPublisher[]>>
	/** Trust everything `domain` publishes for tallies: its agreements are offered and not warned about. */
	trustPublisher(domain: string): Promise<Result<TrustedPublisher[]>>
	/** Stop trusting `domain`. Changes what the party is told from now on, never a tally already agreed. */
	untrustPublisher(domain: string): Promise<Result<TrustedPublisher[]>>
	/** Trust one agreement, not its publisher: it is offered and not warned about. */
	trustAgreement(agreementId: string): Promise<Result<void>>
}
