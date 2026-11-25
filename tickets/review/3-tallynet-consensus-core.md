description: Review the data-and-signing foundation for the lift settlement protocol — the shared transaction record, how a signature over it is made and checked so forgeries and replays are caught, and where that record is stored.
files: packages/tallynet/src/consensus/types.ts, packages/tallynet/src/consensus/digest.ts, packages/tallynet/src/consensus/signature.ts, packages/tallynet/src/consensus/store.ts, packages/tallynet/src/consensus/index.ts, packages/tallynet/src/consensus/digest.test.ts, packages/tallynet/src/consensus/signature.test.ts, packages/tallynet/src/consensus/store.test.ts, packages/tallynet/src/trace.ts, packages/tallynet/package.json, packages/tallynet/docs/design.md
difficulty: hard
----

First of three `tallynet-consensus` tickets (chain: `tallynet-consensus-core` → `tallynet-consensus-participant` → `tallynet-consensus`). This stage is a code-review pass over the foundation the state machine will stand on. **No** state machine, network, or participant was built here — those are the next two tickets (`implement/3.1`, `implement/3.2`), which depend on this slug.

## What was built

A new `src/consensus/` module, mirroring the structure the discovery milestone established (`src/discovery/{types,store}.ts`, `src/trace.ts`, `src/digest.ts`):

- **`types.ts`** — the consensus data model. `SignatureType` (`'P'|'NP'|'C'|'NC'`) + `SignatureTypes` constants; `Signature` (with the opaque `attachment` seam); `TrxLink<TTerms>`; `TrxTopology<TTerms>` (members **array** = immutable core order; links **map** keyed by nonce = order-independent); `TrxRecord<TTerms,TPayload>`; and the `SignatureRejectReason` enum the participant ticket will emit on the `signature-rejected` trace event. Address/member types are **reused** from `../discovery/types.js` (`DependentMember`), not redefined.
- **`digest.ts`** — `recordDigest(kind, record, promises?, hasher?)`, the one canonical signed preimage, a `DigestValue` run through the scaffold's `digest()` (sha256 of deterministic DAG-CBOR). Preimage = `{ k, tx, sc, pl, tp [, pr] }`; `pr` (the sorted promise set) present **only** for `C`/`NC`, omitted (not `undefined`) for `P`/`NP`.
- **`signature.ts`** — `signRecord` / `verifySignature`, both pure (no clock, no store). `verifySignature` **always awaits** the verifier and returns `false` (never throws) on a bad key/value.
- **`store.ts`** — `TrxStore` interface + `MemoryTrxStore` reference impl (record / peer-record / release-once flag); serialisable only, no loggers (logging rides `TraceSink` + injected `Logger` in the participant ticket).
- **`trace.ts`** — the seven consensus events added to the **existing** `TraceEvent` union (not forked). `consensus/index.ts` barrel added but **deliberately not** wired into `src/index.ts` (public surface ships atomically with the final ticket).
- **`package.json`** — `@noble/curves` added to **devDependencies** (ed25519 for signature tests only; must not become a runtime dep).
- **`docs/design.md`** — new § *The commit attachment seam* under Protocol design (Consensus).

## The core correction (the reason this chain exists)

ChipNet never verified any signature (`verifyDigest` returned an un-awaited, always-truthy promise), and sign/verify disagreed on the preimage (sign hashed the signature type, verify did not) — the two bugs masked each other (chipnet-review.md § Transaction module defects). Here:

1. **The signature kind is inside the signed bytes** (`k`), so a `P` relabelled `NP` (or `C`↔`NC`) fails verification — the verifier recomputes with the *claimed* kind.
2. **`tx`+`sc` bind the signature to one transaction**, so a valid signature from another transaction with the same topology fails here (replay defence).
3. **Verification is real and always awaited.**
4. **One preimage, shared** by `signRecord` and `verifySignature`, so they cannot disagree.
5. **Canonical DAG-CBOR**, never `JSON.stringify`/`hashDeep` (ambiguous, forgeable preimages).

## How to validate (use cases)

`yarn workspace tallynet build && yarn workspace tallynet test && yarn workspace tallynet lint` — all green at handoff (**235 tests, 19 suites**; the consensus files add **27 tests across 3 suites**). Tests of note, one per defect row this chain closes:

- **Type substitution** (`digest.test.ts`, `signature.test.ts`): `recordDigest('P',r) ≠ recordDigest('NP',r)`; a `P` signature relabelled `NP` fails `verifySignature`.
- **Replay** (`signature.test.ts`): a signature valid under `(tx-A, sc-A)` fails under `(tx-B, sc-B)` with the same topology.
- **Forgery / wrong signer**: a bit-flipped `value` fails; a signature checked against another member's key fails.
- **Promise-set ordering** (`digest.test.ts`): `recordDigest('C', …, [p1,p2])` == `recordDigest('C', …, [p2,p1])`; different promise sets differ; a promise's `attachment` is dropped before hashing.
- **Commit binds the promise set** (`signature.test.ts`): a commit verifies, then fails once a new promise the referee never saw appears — the convergence edge case the participant ticket must honour (verify commits only once the full promise set is present).
- **Non-canonical base64url**: `verifySignature` returns `false`, never throws.
- **`undefined`/unencodable payload** (`digest.test.ts`): a `Date`/function/`undefined` in the payload throws from `recordDigest` with a JSON-path (`$.pl…`), not a silent bad signature.
- **Round-trip** (`store.test.ts`): a full record (incl. a commit with an opaque `attachment`) + peer copy + released flag survive JSON and `canonicalEncode`; key order is irrelevant.

Real ed25519 (`@noble/curves`) backs the signature tests — the toy symmetric provider in `crypto.test.ts` was not reused, so these exercise a genuine curve.

## Known gaps / what to scrutinise (reviewer: treat tests as a floor)

- **No cross-package digest vector.** `recordDigest`'s bytes are only pinned implicitly (via the scaffold `digest.ts`'s own pinned vectors). The binding ticket wires `taleus-core/src/lift/referee.ts`'s injected `RecordDigest` to this; the two preimages are **not** cross-checked by a shared test vector yet, because the referee injection point is unbound until `tallynet-bind-taleus-core`. Worth a reviewer eye on whether `recordDigest`'s field layout (`k/tx/sc/pl/tp/pr`) is what the referee should sign — the design note says the referee signs core+promises only, which matches, but no test proves byte-equality across packages.
- **`recordDigest` with `C`/`NC` and an absent promise set** produces the empty-set preimage rather than throwing. Safe today (every caller passes `record.promises`, a required array), flagged as a `NOTE:` tripwire at the site.
- **The store holds records by reference** (as the discovery store does). If the participant mutates a saved record in place, the stored/peer copy mutates too and the reachability skip test misreads. Flagged as a `NOTE:` at `store.ts` `savePeerRecord`; the participant ticket must save a distinct object per push.
- **`SignatureRejectReason` is defined but unused** this ticket — only the participant ticket emits `signature-rejected`. It is a type-only import into `trace.ts`, so no runtime coupling; confirm the reason set is complete for the participant's needs (`forged`/`non-member`/`wrong-role`/`replay`/`changed`/`equivocation`/`core-mismatch`/`expired`).
- **No negative-majority / referee-set logic here** — `isConsensus`, empty-referee-set rejection, tie→void all live in the participant ticket. This ticket deliberately builds only record + signing + store.
- **`promise-signed` trace field renamed** `type` → `signatureType` (the ticket's schematic `{..., type:'P'|'NP'}` collides with the union discriminant `type`). Documented in `trace.ts`.

## Tripwires parked (index — see the `NOTE:` at each site)

- `digest.ts` `recordDigest`: absent promise set for a commit → empty-set preimage, not a throw (conditional on a future direct caller omitting it).
- `digest.ts` `canonicalPromiseSet`: re-maps+re-sorts the whole promise set every commit digest; memoize only if routes ever carry very large promise sets.
- `store.ts` `savePeerRecord`: by-reference storage; mutate-in-place after save would corrupt the skip test (concern for the participant author).
