description: Build the data and signing foundation for the part of the lift protocol that gets everyone on a route to sign on and settle — the record everyone passes around, how a signature is made and checked so forgeries and replays are caught, and where that record is stored.
prereq: tallynet-discovery
files: packages/tallynet/src/consensus/types.ts, packages/tallynet/src/consensus/digest.ts, packages/tallynet/src/consensus/signature.ts, packages/tallynet/src/consensus/store.ts, packages/tallynet/src/consensus/index.ts, packages/tallynet/src/trace.ts, packages/tallynet/src/digest.ts, packages/tallynet/src/crypto.ts, packages/tallynet/src/discovery/types.ts, packages/tallynet/package.json, packages/tallynet/docs/design.md, packages/tallynet/docs/chipnet-review.md
difficulty: hard
----

First of three `tallynet-consensus` tickets (chain: **this** → `tallynet-consensus-participant` → `tallynet-consensus`). It lays the foundation the state machine (next ticket) stands on: the transaction record shape, the canonical signed preimage with its fix for ChipNet's never-verifying signatures, the sign/verify helpers, the serialisable state store, and the consensus trace events. No state machine, no network, no participant yet — those are the next two tickets.

Read `packages/tallynet/docs/chipnet-review.md` § Transaction and § Transaction module defects (the rows this chain must close), and `docs/design.md` § Protocol design (Consensus) and § Canonical encoding. The consensus module mirrors the structure the discovery milestone already established (`src/discovery/{types,store}.ts`, `src/trace.ts`, `src/digest.ts`), so follow those patterns rather than inventing new ones.

## What this module is

Consensus carries ChipNet's model unchanged in shape: a **self-describing transaction record** — correlation codes, an opaque payload, the route topology, a list of promise signatures and a list of commit signatures — that every node merges by **union** and pushes to reachable members until it settles. Participants sign a promise; referees vote a commit; a majority of referees settles it. This ticket builds the record, the signing, and the store; it does **not** build the merge/advance/push logic.

The single most important correction: in ChipNet, `verifyDigest` returned an un-awaited promise (always truthy) so **no signature was ever verified**, and sign/verify disagreed on the preimage (sign hashed the signature type, verify did not), so the two bugs masked each other (review § Transaction module defects, `participant.ts:224,255` and `:159,173` vs `:222,253`). Here, verification is real and sign/verify share one preimage that **binds the signature type into the signed bytes**.

## Types (`src/consensus/types.ts`)

Reuse `Address`, `IdentifiedMember`, `DependentMember`, `MemberTypes`, `addressesMatch` from `../discovery/types.js` — do not redefine them. New types:

```ts
/** promise / no-promise / commit / no-commit(void). The kind is bound INTO the signed preimage. */
export type SignatureType = 'P' | 'NP' | 'C' | 'NC'
export const SignatureTypes = { promise:'P', noPromise:'NP', commit:'C', noCommit:'NC' } as const

/**
 * One signature on a record. `address` is the signer's key (base64url, = a topology member's key);
 * `value` is the base64url signature bytes over the canonical preimage (see digest.ts).
 * `attachment` is OPAQUE host data a signer may ride alongside its signature (a referee's per-edge
 * settlement signatures at commit — see the design note below). TallyNet never inspects, digests, or
 * validates `attachment`; it travels by union with the signature. Absent on promise-phase signatures.
 */
export interface Signature {
	type: SignatureType
	address: string
	value: string
	attachment?: unknown   // opaque; NOT part of the preimage. See § The commit attachment seam.
}

/** One edge of the route, keyed in the topology by its per-session nonce. Addresses are member keys. */
export interface TrxLink<TTerms> {
	source: string              // member key at the edge's source
	target: string              // member key at the edge's target
	intents: Record<string, TTerms>
}

/**
 * The transaction-time route view. `members` is an ARRAY whose order the originator fixes once and
 * which is part of the immutable core (a reordering reads as a core mismatch next ticket). `links` is
 * a map keyed by nonce, so DAG-CBOR's sorted-map-keys makes link order irrelevant.
 */
export interface TrxTopology<TTerms> {
	members: DependentMember[]            // each carries types:('P'|'R')[]; referees nominated via dependsOn
	links: Record<string, TrxLink<TTerms>>
}

/**
 * The record itself. `transactionCode` and `sessionCode` are self-expiring codes in session-code.ts
 * format (reuse isValid/isExpired/expiresAt for BOTH). `payload` is the opaque Taleus value and MUST
 * canonically encode (it is digest-covered). `promises`/`commits` accumulate by union.
 */
export interface TrxRecord<TTerms, TPayload> {
	transactionCode: string
	sessionCode: string
	payload: TPayload
	topology: TrxTopology<TTerms>
	promises: Signature[]
	commits: Signature[]
}

/** Why a signature was refused on merge/verify. Carried on the `signature-rejected` trace event. */
export type SignatureRejectReason =
	| 'forged'        // verification failed against a determined preimage (covers type-substitution)
	| 'non-member'    // signer address is not in topology.members
	| 'wrong-role'    // a non-P member signed P/NP, or a non-R member signed C/NC
	| 'replay'        // a valid signature for a DIFFERENT (tx,session) with the same topology
	| 'changed'       // the signer already contributed a different value for this phase
	| 'equivocation'  // the signer contributed both faces of a phase (P&NP, or C&NC)
	| 'core-mismatch' // the record's immutable core differs from the stored copy
	| 'expired'       // transaction or session code expired
```

## The signed preimage (`src/consensus/digest.ts`)

One function, exported for the Taleus referee (`packages/taleus-core/src/lift/referee.ts` injects a record-digest function; the binding ticket wires this to it):

```ts
export function recordDigest<TTerms, TPayload>(
	kind: SignatureType,
	record: Pick<TrxRecord<TTerms,TPayload>, 'transactionCode'|'sessionCode'|'payload'|'topology'>,
	promises?: readonly Signature[],   // REQUIRED for 'C'/'NC'; ignored (and omitted) for 'P'/'NP'
	hasher?: Hasher,
): Uint8Array
```

Preimage, built as a `DigestValue` and run through the scaffold's `digest()`/`canonicalEncode()` (`../digest.js`) — sha256 of deterministic DAG-CBOR, the one encoding this repo signs over:

```
{ k: kind, tx: transactionCode, sc: sessionCode, pl: payload, tp: topology
  [, pr: <promises> ]   // present ONLY for kind 'C'|'NC'
}
```

- **`k` (the kind) is inside the signed bytes** — this is the fix for the type-substitution hole. A `P` signature relabelled `NP`, or a `C` relabelled `NC`, fails verification because the verifier recomputes the preimage with the *claimed* type and gets different bytes.
- **`tx` + `sc` bind the signature to this transaction** — a valid signature from another transaction with the same topology fails here (replay defence) because its `tx`/`sc` differ.
- **`pr` (commit/no-commit only)** is the promise set the vote is cast over, canonicalised: map each promise to `{ type, address, value }` (drop `attachment`, which promises never carry anyway) and **sort by `address`, then `type`, then `value`** (bytewise on the base64url strings) so the list is order-independent. Arrays are order-sensitive in DAG-CBOR, so this explicit sort is mandatory — do not rely on insertion order.
- The `pr` key is **omitted entirely** for `P`/`NP` (not set to `undefined` — DAG-CBOR rejects `undefined`; follow the discovery store's "omit, don't undefine" discipline).
- **Payload must canonically encode.** `TPayload` is generic, but at this boundary it is passed to `canonicalEncode`, which throws with a JSON-path on anything DAG-CBOR can't represent. Document that a signing host must supply a `DigestValue`-compatible payload.

**Why the commit preimage includes the promise set, and the convergence consequence** (carry into the participant ticket as an edge case): binding the vote to the exact promises keeps a referee's commit honest about which promises it saw. A node verifying a commit must therefore hold the same promise set. The next ticket only ever verifies commits once the full participant-promise set is present (the promise phase completes before the commit phase opens), so verification is deterministic; an early-arriving commit (out-of-order delivery) is retained by union but simply not yet countable, never treated as forged. State this in the digest module doc so the participant author inherits the reasoning.

## Sign / verify (`src/consensus/signature.ts`)

```ts
export async function signRecord<TTerms,TPayload>(
	signer: Signer, kind: SignatureType,
	record: TrxRecord<TTerms,TPayload>, hasher?: Hasher,
): Promise<Signature>
// value = toBase64url(await signer.sign(recordDigest(kind, record, record.promises, hasher)))
// address = toBase64url(signer.publicKey); attachment is added by the caller, not here.

export async function verifySignature<TTerms,TPayload>(
	verifier: Verifier, signature: Signature,
	record: TrxRecord<TTerms,TPayload>, hasher?: Hasher,
): Promise<boolean>
// recompute recordDigest(signature.type, record, record.promises); verify signature.value against
// signature.address as a key. ALWAYS await (ChipNet's bug was not awaiting). Never throws on a bad
// key/sig — a bad input is a failed check (Verifier already guarantees this).
```

Use `Signer`/`Verifier`/`Hasher` from `../crypto.js` (tallynet ships no curve; ed25519 is injected). The base64url codec is `../base64url.js`. Keep these two helpers pure (no clock, no store) — they are the primitives the state machine and the referee both call.

## The store (`src/consensus/store.ts`)

Mirror `discovery/store.ts`: a serialisable interface + an in-memory reference implementation. It persists only JSON/DAG-CBOR-round-trippable data (a SQL backing must be possible) — no promises, functions, or class instances.

```ts
export interface TrxStore<TTerms, TPayload> {
	getRecord(transactionCode: string): Promise<TrxRecord<TTerms,TPayload> | undefined>
	saveRecord(record: TrxRecord<TTerms,TPayload>): Promise<void>
	/** The last copy we successfully pushed to `address` (reachability skip test next ticket). */
	getPeerRecord(transactionCode: string, address: string): Promise<TrxRecord<TTerms,TPayload> | undefined>
	savePeerRecord(transactionCode: string, address: string, record: TrxRecord<TTerms,TPayload>): Promise<void>
	/** The release-once flag, idempotent across restarts. */
	isReleased(transactionCode: string): Promise<boolean>
	setReleased(transactionCode: string): Promise<void>
}
export class MemoryTrxStore<TTerms,TPayload> implements TrxStore<TTerms,TPayload> { /* Maps */ }
```

**Logging is not store state.** ChipNet kept three loggers inside `TrxParticipantState`; drop them. As discovery did with `reportCycles`/timing, logging rides the `TraceSink` plus an injected `Logger` (same `Logger` shape as `taleus-core/src/lift/commit.ts`) in the participant ticket — not the store. Say so in the store module doc.

## Consensus trace events (`src/trace.ts`)

Add consensus members to the **existing** exported `TraceEvent` union (do not fork it — the simulator consumes one union; same contract as discovery). Consensus events additionally carry `transactionCode` (discovery's `TraceBase` keeps `time`/`nodeId`/`sessionCode`; add `transactionCode` on each consensus event, not to `TraceBase`). The minimum set (populated in the participant ticket; defined here):

- `record-pushed` `{ transactionCode, to: string, promiseCount, commitCount, ok: boolean }` — to whom, signature counts, and whether the push succeeded (a failed push is `ok:false`, logged once).
- `record-received` `{ transactionCode, from?: string, promiseCount, commitCount }`
- `promise-signed` `{ transactionCode, type: 'P' | 'NP' }`
- `signature-rejected` `{ transactionCode, reason: SignatureRejectReason }`
- `referee-vote` `{ transactionCode, decision: 'C' | 'NC' }`
- `settled` `{ transactionCode, decision: 'commit' | 'void' }`
- `resources-released` `{ transactionCode, success: boolean }`

Honour the disclosure invariant already documented in `trace.ts`: every field is something the emitting node already knows (its own id, a member address that is public by default in the route, its own counts) — never a neighbour's link id. `to`/`from` are member **addresses** (public), never nonces or link ids.

## The commit attachment seam (design decision — document in design.md)

The Taleus referee produces **two** signatures at commit: TallyNet's whole-record commit signature (`commits[]`), and a **separate per-edge** signature the Quereus schema verifies (`packages/taleus-core/src/lift/referee.ts`). The per-edge signatures must travel with the record. They cannot live in `payload`: `payload` is part of the immutable, promise-signed core, and it is set by the originator *before* any referee has committed. So they ride as the **opaque `attachment`** on the referee's commit `Signature`, which is deliberately **not** part of the whole-record preimage (matching `taleus-core`'s injected record digest, which covers only the immutable core + promises). They are self-authenticating at the host layer: each per-edge signature verifies against the referee's known key under the schema's own digest, so a stripped or swapped `attachment` fails at the destination strand — a liveness concern, never a safety one. Record this reconciliation in `docs/design.md` § Protocol design (Consensus) so the binding ticket maps `taleus-core`'s `edgeSignatures` onto the attachment without surprise, and update `chipnet-review.md`'s note if helpful.

## TODO

**Phase 1 — types + digest**
- Add `@noble/curves` to `packages/tallynet/package.json` **devDependencies** (ed25519 for signature tests only; it must NOT become a runtime dependency — tallynet ships no curve, per design.md § Scope and boundaries).
- Write `src/consensus/types.ts` reusing discovery address/member types.
- Write `src/consensus/digest.ts` with `recordDigest`, binding `kind`, `tx`, `sc`, and (for C/NC) the sorted promise set. Unit-test: kind changes the bytes; tx/sc change the bytes; promise-set order does not; `P`/`NP` omit `pr`; payload that can't encode throws with a path.

**Phase 2 — sign/verify**
- Write `src/consensus/signature.ts` (`signRecord`, `verifySignature`), always awaiting the verifier.
- Unit-test with a `@noble/curves` ed25519 signer/verifier: a round-trip verifies; a flipped bit fails; a `P` relabelled `NP` fails; a signature made for tx A fails under tx B with the same topology (replay); a signature from one member fails against another member's key.

**Phase 3 — store + trace + barrel**
- Write `src/consensus/store.ts` (`TrxStore`, `MemoryTrxStore`); test a record + peer copy + released flag round-trip through JSON and through `canonicalEncode` (as `discovery/store.test.ts` does).
- Extend the `TraceEvent` union in `src/trace.ts` with the consensus events above; keep `safeTraceSink`/`noopTraceSink` unchanged.
- Add `src/consensus/index.ts` re-exporting the three modules; **do not** add it to `src/index.ts` yet (the public barrel ships with the final `tallynet-consensus` ticket, so the surface lands atomically with a working state machine).
- `yarn workspace tallynet build && test && lint` green.

## Edge cases & interactions (verified by this ticket's unit tests)

- **Type substitution**: a `P` signature relabelled `NP` (same value, changed `type`) fails `verifySignature` — the kind is in the preimage.
- **Replay across transactions**: a signature valid under `(txA, scA)` with topology T fails under `(txB, scB)` with the same T.
- **Forgery / wrong signer**: a bit-flipped `value` fails; a signature verified against a different member's key fails.
- **Promise-set ordering**: `recordDigest('C', …, promises)` is invariant to the order `promises` is given in; two permutations hash equal.
- **`undefined` keys**: no digest preimage, stored record, or trace event ever carries an explicit `undefined`-valued key (DAG-CBOR rejects it) — follow the discovery "omit, don't undefine" discipline and prove a record round-trips through `canonicalEncode`.
- **Payload that can't encode**: a payload containing a `Date`/function/`undefined` throws from `recordDigest`/`canonicalEncode` with a JSON-path, not a silent bad signature.
- **bigint vs number**: inherited from the scaffold digest (`digest(1) === digest(1n)`); harmless because amounts cross as decimal strings — do not re-litigate, just don't put bare integers that matter into the payload.

## Tests to plan

Unit only (no network, no state machine this ticket): the digest cross-checks above; the sign/verify adversarial cases above; the store round-trip. These are the "one test per defect row" down payment for the rows about `verifyDigest` never running, sign/verify preimage disagreement, and the `hash-deep`/`JSON.stringify` non-canonical preimage — each becomes a concrete passing/failing assertion here.
