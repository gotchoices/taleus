import { digest, signText, type KeyPairText } from '../store/index.js'
import type { RowWrite } from '../store/strand.js'

/**
 * Negotiation: each party publishes the credit it will extend, one of them proposes a
 * contract binding both, and the other countersigns.
 *
 * Two shapes, and the difference between them is the whole point. **Credit terms are
 * unilateral** -- a grantor signs alone, because saying how much you are willing to be
 * owed obliges nobody else. **A contract is bilateral** -- it carries both signatures over
 * the same digest, and until it does there is no tally, only an offer.
 */

export interface CreditTermsRevision {
	/** The grantor: the party saying how much it will let the other owe it. */
	sid: string
	tallyCid: string
	revision: number
	creditLimit: number
	/** Days of notice owed before a *restrictive* change takes effect. */
	callDays: number
	/** When the grantor signed it. */
	date: string
	/** When it takes effect. Revision 1, and any permissive change, take effect at once. */
	effectiveDate: string
	/**
	 * Contract-specific parameters, as JSON text.
	 *
	 * The schema documents this as optional and declares it NOT NULL (`Args text`, with no
	 * `null` and no default), so it cannot actually be omitted -- see test/STATUS.md § 0.
	 * Empty text stands in, and that is what the signature covers.
	 */
	args?: string
	signer: KeyPairText
}

export function publishCreditTerms(terms: CreditTermsRevision): RowWrite {
	const args = terms.args ?? ''
	return {
		table: 'CreditTerms',
		row: {
			Sid: terms.sid,
			Revision: terms.revision,
			CreditLimit: terms.creditLimit,
			CallDays: terms.callDays,
			Args: args,
			Date: terms.date,
			EffectiveDate: terms.effectiveDate,
			SignerKey: terms.signer.publicKey,
			Signature: signText(
				terms.signer,
				digest(
					terms.tallyCid,
					terms.sid,
					terms.revision,
					terms.creditLimit,
					terms.callDays,
					args,
					terms.date,
					terms.effectiveDate,
				),
			),
		},
	}
}

export type Side = 'S' | 'F'

export interface ContractOffer {
	tallyCid: string
	sequenceNumber: number
	/** The agreement document both parties are signing up to, by content address. */
	contractCid: string
	proposer: Side
	stockCreditTermsRevision: number
	foilCreditTermsRevision: number
	denomination?: string
	denominationScale?: number
	signer: KeyPairText
}

/**
 * Put terms on the table. The proposal carries both sides' terms revisions, so an offer is
 * a complete statement of what the tally would be -- not half of one.
 */
export function proposeContract(offer: ContractOffer): RowWrite {
	return {
		table: 'TallyContractProposal',
		row: {
			SequenceNumber: offer.sequenceNumber,
			ContractCid: offer.contractCid,
			Proposer: offer.proposer,
			StockCreditTermsRevision: offer.stockCreditTermsRevision,
			FoilCreditTermsRevision: offer.foilCreditTermsRevision,
			Denomination: offer.denomination ?? 'CHIP',
			DenominationScale: offer.denominationScale ?? 0,
			SignerKey: offer.signer.publicKey,
			Signature: signText(
				offer.signer,
				digest(
					offer.tallyCid,
					offer.sequenceNumber,
					offer.contractCid,
					offer.proposer,
					offer.stockCreditTermsRevision,
					offer.foilCreditTermsRevision,
					offer.denomination ?? 'CHIP',
					offer.denominationScale ?? 0,
				),
			),
		},
	}
}

export interface SignedContract {
	tallyCid: string
	number: number
	contractCid: string
	stockCreditTermsRevision: number
	foilCreditTermsRevision: number
	denomination?: string
	denominationScale?: number
	stockSigner: KeyPairText
	foilSigner: KeyPairText
}

/**
 * The contract itself: one row carrying **both** signatures over the same digest.
 *
 * Note what the digest does not include -- the proposer. An offer records who put it on
 * the table; the agreement does not care, because by then both have signed it. That is
 * also why the same fields, signed by both, are what makes a tally rather than an offer.
 */
export function signContract(contract: SignedContract): RowWrite {
	const covered = digest(
		contract.tallyCid,
		contract.number,
		contract.contractCid,
		contract.stockCreditTermsRevision,
		contract.foilCreditTermsRevision,
		contract.denomination ?? 'CHIP',
		contract.denominationScale ?? 0,
	)
	return {
		table: 'TallyContract',
		row: {
			Number: contract.number,
			ContractCid: contract.contractCid,
			StockCreditTermsRevision: contract.stockCreditTermsRevision,
			FoilCreditTermsRevision: contract.foilCreditTermsRevision,
			Denomination: contract.denomination ?? 'CHIP',
			DenominationScale: contract.denominationScale ?? 0,
			StockSignerKey: contract.stockSigner.publicKey,
			StockSignature: signText(contract.stockSigner, covered),
			FoilSignerKey: contract.foilSigner.publicKey,
			FoilSignature: signText(contract.foilSigner, covered),
		},
	}
}
