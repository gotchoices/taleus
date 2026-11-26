/**
 * The one canonical preimage a transaction-record signature is made and checked over. Exported for
 * the Taleus voter too: `packages/taleus-core/src/lift/referee.ts` injects a record-digest function
 * so it signs exactly what TallyNet verifies; the binding ticket wires that injection to this.
 *
 * This is the heart of the two-bug fix from docs/chipnet-review.md § Transaction module defects. In
 * ChipNet:
 *   - `verifyDigest` returned an un-awaited promise (always truthy), so **no signature was ever
 *     verified** (`participant.ts:224,255`); and
 *   - sign hashed the signature type into the preimage while verify did not (`:159,173` vs
 *     `:222,253`), so once verification were awaited every signature would fail.
 * The two masked each other. Here there is ONE preimage, used by both `signRecord` and
 * `verifySignature`, and it **binds the signature kind into the signed bytes**.
 *
 * The preimage is a {@link DigestValue} run through the scaffold's `digest()` (`../digest.js`) —
 * sha256 of deterministic DAG-CBOR, the single encoding this repo signs over:
 *
 *     { k: kind, tx: transactionCode, sc: sessionCode, pl: payload, tp: topology, mt: method
 *       [, lc: liftContract ]              // present ONLY when the record carries a lift-contract CID
 *       [, pr: <canonical promise set> ]   // present ONLY for kind 'C' | 'NC'
 *     }
 *
 * Why each field is there:
 *   - **`k` (the kind) is inside the signed bytes.** A `P` relabelled `NP`, or a `C` relabelled `NC`,
 *     fails verification because the verifier recomputes the preimage with the *claimed* type and gets
 *     different bytes. This closes the type-substitution hole directly.
 *   - **`tx` + `sc` bind the signature to this transaction.** A signature valid under one
 *     `(transactionCode, sessionCode)` with topology T fails under a different `(tx, sc)` with the
 *     same T — the replay defence.
 *   - **`pr` (commit/no-commit only)** is the promise set the vote is cast over, canonicalised: each
 *     promise is reduced to `{ type, address, value }` (its opaque `attachment` is dropped — promises
 *     never carry one anyway) and the list is **sorted by `address`, then `type`, then `value`**
 *     (bytewise on the base64url strings). Arrays are order-sensitive under DAG-CBOR, so this explicit
 *     sort is mandatory — insertion order must not change the bytes.
 *   - The `pr` key is **omitted entirely** for `P`/`NP` — not set to `undefined`, which DAG-CBOR
 *     rejects (follow the discovery store's "omit, don't undefine" discipline).
 *
 * **Payload must canonically encode.** `TPayload` is generic, but at this boundary it is handed to
 * `canonicalEncode`, which throws with a JSON-path on anything DAG-CBOR cannot represent (a `Date`, a
 * function, `undefined`, …). A signing host must supply a `DigestValue`-compatible payload.
 *
 * **Why the commit preimage includes the promise set, and the convergence consequence** (carried into
 * the participant ticket as an edge case): binding a commit vote to the exact promise set keeps a
 * voter honest about which promises it saw. A node verifying a commit must therefore hold the same
 * promise set. The participant ticket only ever verifies commits once the full participant-promise set
 * is present — the promise phase completes before the commit phase opens — so verification is
 * deterministic. An early-arriving commit (out-of-order delivery) is retained by union but simply not
 * yet countable; it is **never** treated as forged merely because the promise set is still filling.
 */

import { digest, type DigestValue } from '../digest.js'
import type { Hasher } from '../crypto.js'
import type { Signature, SignatureType, TrxRecord } from './types.js'

/**
 * Compute the canonical preimage digest a signature of `kind` is made/checked over for `record`.
 *
 * @param kind      the signature kind, bound into the bytes.
 * @param record    the immutable, digest-covered core (`transactionCode`, `sessionCode`, `payload`,
 *                  `topology`, `method`, and the optional `liftContract`). Only these fields are read —
 *                  never `promises` (except via the explicit `promises` arg) nor `commits`.
 * @param promises  the promise set a commit is cast over. REQUIRED for `'C'`/`'NC'` (pass the record's
 *                  full promise set); ignored and omitted from the preimage for `'P'`/`'NP'`.
 * @param hasher    sha256 port; defaults to `@noble/hashes`.
 */
export function recordDigest<TTerms, TPayload>(
	kind: SignatureType,
	record: Pick<TrxRecord<TTerms, TPayload>, 'transactionCode' | 'sessionCode' | 'payload' | 'topology' | 'method' | 'liftContract'>,
	promises?: readonly Signature[],
	hasher?: Hasher,
): Uint8Array {
	const preimage: Record<string, DigestValue> = {
		k: kind,
		tx: record.transactionCode,
		sc: record.sessionCode,
		pl: record.payload as DigestValue,
		tp: record.topology as unknown as DigestValue,
		mt: record.method as unknown as DigestValue,
	}
	// `lc` (the lift-contract CID) is part of the signed core, but bound only when present — omit the
	// key entirely when absent, never set it to `undefined` (DAG-CBOR rejects it), as the `pr` key does.
	if (record.liftContract !== undefined) {
		preimage.lc = record.liftContract
	}
	if (kind === 'C' || kind === 'NC') {
		// NOTE: an absent promise set for a commit becomes the empty-set preimage, not a throw. Safe
		// today — signRecord/verifySignature always pass record.promises (a required array field) — but
		// a future direct caller that omits it for C/NC would silently sign over the empty set.
		preimage.pr = canonicalPromiseSet(promises ?? [])
	}
	return digest(preimage, hasher)
}

/**
 * The promise set as it enters a commit preimage: each promise reduced to its signed essentials and
 * the list sorted into one canonical order, so two permutations of the same promises hash equal.
 *
 * Sort key is `address`, then `type`, then `value`, compared bytewise. The base64url charset and the
 * `SignatureType` literals are all single-byte ASCII, so JavaScript's `<`/`>` on these strings is a
 * bytewise comparison. `attachment` is intentionally not copied — it is opaque and never signed.
 */
function canonicalPromiseSet(promises: readonly Signature[]): DigestValue {
	// NOTE: re-maps and re-sorts the whole promise set on every commit digest; a participant verifying
	// each commit pays this per verify. Fine at lift scale (a handful of participants); if routes ever
	// carry very large promise sets, memoize the canonical set per (record, promise-set) instead.
	return promises
		.map((p) => ({ type: p.type, address: p.address, value: p.value }))
		.sort((a, b) => compare(a.address, b.address) || compare(a.type, b.type) || compare(a.value, b.value))
}

/** Bytewise string compare → -1 / 0 / 1 (ASCII inputs, so code-unit order is byte order). */
function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}
