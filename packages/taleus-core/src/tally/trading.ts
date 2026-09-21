import { digest, signText, type KeyPairText } from '../store/index.js'
import type { RowWrite } from '../store/strand.js'

/**
 * Trading variables: a party's published, unilateral lift policy.
 *
 * They tell the counterparty's lift agent how much balance movement this party will accept and
 * at what cost. They govern **lifts** only -- a direct chit is never gated by them, because a
 * party may always pledge directly to its counterparty (`docs/trading-variables.md`).
 *
 * Each party sets its own four and signs them alone, so a tally carries **eight** values. They
 * are not redundant: balance is one signed number, but each party's variables govern its own
 * side of zero, in its own direction.
 *
 * The one deliberate departure from MyCHIPs is that a variable means the same thing whichever
 * seat you hold. In MyCHIPs a `reward` was a "lift margin" on a foil and a "drop margin" on a
 * stock -- same column, two meanings. Here every value is expressed from the **issuing party's
 * own perspective**, which is the same expressive power without the case analysis.
 */

export interface TradingVariables {
	/** The party publishing them. */
	sid: string
	tallyCid: string
	revision: number
	/** Ideal balance to accumulate through lifts; movement up to here is free. */
	target: number
	/** The most this party will accrue through lifts. Never below `target`. */
	bound: number
	/** Charged on accumulation above `target`, up to `bound`. Parts per million. */
	reward: number
	/** Charged on drops -- lifts reducing what this party has accumulated. Parts per million. */
	clutch: number
	signer: KeyPairText
}

export function publishTradingVariables(variables: TradingVariables): RowWrite {
	return {
		table: 'TradingVariable',
		row: {
			Sid: variables.sid,
			Revision: variables.revision,
			Target: variables.target,
			Bound: variables.bound,
			Reward: variables.reward,
			Clutch: variables.clutch,
			SignerKey: variables.signer.publicKey,
			Signature: signText(
				variables.signer,
				digest(
					variables.tallyCid,
					variables.sid,
					variables.revision,
					variables.target,
					variables.bound,
					variables.reward,
					variables.clutch,
				),
			),
		},
	}
}
