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

/** What both parties sign to make a contract. Notably *not* the proposer -- see `signContract`. */
export interface ContractTerms {
	tallyCid: string
	number: number
	contractCid: string
	stockCreditTermsRevision: number
	foilCreditTermsRevision: number
	denomination?: string
	denominationScale?: number
}

/** The one message a contract's two signatures both cover. */
export function contractDigest(terms: ContractTerms): string {
	return digest(
		terms.tallyCid,
		terms.number,
		terms.contractCid,
		terms.stockCreditTermsRevision,
		terms.foilCreditTermsRevision,
		terms.denomination ?? 'CHIP',
		terms.denominationScale ?? 0,
	)
}

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
 *
 * It also carries `ContractSignature`: the proposer's signature over the **contract** digest,
 * which is a different message from this proposal's own (that one folds in `Proposer`). Without
 * it the offer would be un-acceptable -- `TallyContract` needs both signatures at insert, and
 * nothing else would carry the proposer's to the other party. Handing it over costs nothing: it
 * verifies against exactly these fields and no others.
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
			ContractSignature: signText(
				offer.signer,
				contractDigest({ ...offer, number: offer.sequenceNumber }),
			),
		},
	}
}

export interface SignedContract extends ContractTerms {
	/** Which side proposed, and therefore which signature is the relayed one. */
	proposer: Side
	/** The proposer's key and their `ContractSignature`, taken from the standing proposal. */
	proposerSignerKey: string
	proposerSignature: string
	/** The accepting party, signing now. */
	accepter: KeyPairText
}

/**
 * The contract itself: one row carrying **both** signatures over the same digest.
 *
 * Only one of them is made here. The other was made when the offer was put on the table and
 * travelled in `TallyContractProposal.ContractSignature` -- because the two parties are two
 * parties, and the accepter does not hold the proposer's key. An earlier version of this
 * function took both key pairs, which only worked in a test that played both sides; building
 * the API is what surfaced it (see test/STATUS.md § 0).
 *
 * Note what the digest does not include -- the proposer. An offer records who put it on the
 * table; the agreement does not care, because by then both have signed it. That is also why
 * relaying the proposer's signature is safe: it commits them to these terms and to nothing the
 * accepter could substitute.
 */
export function signContract(contract: SignedContract): RowWrite {
	const mine = signText(contract.accepter, contractDigest(contract))
	const stockIsProposer = contract.proposer === 'S'
	return {
		table: 'TallyContract',
		row: {
			Number: contract.number,
			ContractCid: contract.contractCid,
			StockCreditTermsRevision: contract.stockCreditTermsRevision,
			FoilCreditTermsRevision: contract.foilCreditTermsRevision,
			Denomination: contract.denomination ?? 'CHIP',
			DenominationScale: contract.denominationScale ?? 0,
			StockSignerKey: stockIsProposer ? contract.proposerSignerKey : contract.accepter.publicKey,
			StockSignature: stockIsProposer ? contract.proposerSignature : mine,
			FoilSignerKey: stockIsProposer ? contract.accepter.publicKey : contract.proposerSignerKey,
			FoilSignature: stockIsProposer ? mine : contract.proposerSignature,
		},
	}
}
