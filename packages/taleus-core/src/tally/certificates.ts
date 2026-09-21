import { digest, signText, type KeyPairText } from '../store/index.js'
import type { RowWrite } from '../store/strand.js'

/**
 * Party certificates: who someone says they are, in the real world.
 *
 * A `Sid` is strand-local and deliberately anonymous -- one person is not one identity, and
 * nothing in the protocol tries to make them so (`docs/identity.md`). A certificate is the
 * payload where a party *chooses* to say more: a company number, a licence, a tax id, an
 * address. Any member may require one and any member may provide one, and **no protocol rule
 * ever reads it**. It is evidence between the parties, revisioned and signed so that what was
 * claimed, and when, is not later deniable.
 *
 * Opaque text by design: the schema stores it as a single `Certificate` column and validates
 * nothing about its shape, because what counts as adequate identification is a judgement the
 * two parties make, not one a schema can encode.
 */

export interface PartyCertificate {
	/** The party the certificate describes and who signs it. */
	sid: string
	revision: number
	/** Serialized payload. The schema neither parses nor constrains it. */
	certificate: string
	signer: KeyPairText
}

export function publishCertificate(certificate: PartyCertificate): RowWrite {
	return {
		table: 'PartyCertificate',
		row: {
			PartySid: certificate.sid,
			Revision: certificate.revision,
			Certificate: certificate.certificate,
			SignerKey: certificate.signer.publicKey,
			Signature: signText(
				certificate.signer,
				digest(certificate.sid, certificate.revision, certificate.certificate),
			),
		},
	}
}
