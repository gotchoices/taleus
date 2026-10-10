import type { RowWrite } from '../store/strand.js'

/**
 * The documents a tally's contracts are made of, kept in the strand (`Document`).
 *
 * Each is a Stroc document -- canonical DAG-JSON text -- filed under its CID. The core stores and
 * reads them; it does not fetch or verify them. Whoever offers a contract stores it and every
 * document it includes, so the counterparty can read the whole contract from the tally itself;
 * a document already here is left alone, whoever stored it.
 */
export interface DocumentRow {
	/** The document's CIDv1 (dag-json, sha2-256, base32). */
	cid: string
	/** Its canonical DAG-JSON text, exactly the bytes the CID hashes. */
	json: string
}

/**
 * Store `document` unless the tally already holds it. Like any `insert or ignore`, a document the
 * schema refuses (a malformed CID, and once the schema checks hashes, bytes that do not match it)
 * is left out rather than failing the act -- so a reader still checks that a contract is complete.
 */
export function storeDocument(document: DocumentRow): RowWrite {
	return { table: 'Document', row: { Cid: document.cid, Json: document.json }, ifAbsent: true }
}
