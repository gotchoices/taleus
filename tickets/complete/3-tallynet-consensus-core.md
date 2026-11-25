description: The data-and-signing foundation for the lift settlement protocol — the shared transaction record, how a signature over it is made and checked so forgeries and replays are caught, and where that record is stored. Reviewed and accepted.
files: packages/tallynet/src/consensus/types.ts, packages/tallynet/src/consensus/digest.ts, packages/tallynet/src/consensus/signature.ts, packages/tallynet/src/consensus/store.ts, packages/tallynet/src/consensus/index.ts, packages/tallynet/src/consensus/digest.test.ts, packages/tallynet/src/consensus/signature.test.ts, packages/tallynet/src/consensus/store.test.ts, packages/tallynet/src/trace.ts, packages/tallynet/package.json, packages/tallynet/docs/design.md
----

First of three `tallynet-consensus` tickets (`tallynet-consensus-core` → `tallynet-consensus-participant` → `tallynet-consensus`). This is the completed **review** of the foundation; the state machine, network and participant are the next two tickets (`implement/3.1`, `implement/3.2`), which depend on this slug.

## What was built (and reviewed)

A new `src/consensus/` module: the record data model (`types.ts`), the one canonical signed preimage (`digest.ts`), pure sign/verify primitives (`signature.ts`), the durable store interface + in-memory reference impl (`store.ts`), the seven consensus trace events folded into the existing `TraceEvent` union (`trace.ts`), an internal barrel (`index.ts`, deliberately **not** wired into the public `src/index.ts`), `@noble/curves` added to **devDependencies** (ed25519 for signature tests only), and a new design-doc section (*The commit attachment seam*).

The chain exists to close two ChipNet defects that masked each other (no signature was ever verified; sign and verify hashed different preimages). The fix: the signature kind lives **inside** the signed bytes (`k`), `tx`+`sc` bind a signature to one transaction (replay defence), verification is real and always awaited, and `signRecord`/`verifySignature` share the one `recordDigest` preimage over canonical DAG-CBOR.

## How it was validated

`yarn workspace tallynet build && test && lint` — all green. **239 tests, 19 suites** (the consensus files contribute **31 tests across 3 suites** — 27 from the implementer, **+4 added in this review**, see below).

## Review findings

**Verdict: accepted.** No major findings; no new `fix/`/`backlog`/`blocked` tickets filed. One minor test gap fixed inline.

### Checked — and holds
- **The two-bug correction is real in code, not just claimed.** The kind is in the preimage (`digest.ts` `k`); `verifySignature` recomputes with the *claimed* kind; `tx`+`sc` bind the transaction; `signRecord`/`verifySignature` call the same `recordDigest`; verification is `return await verifier.verify(...)`. Tests exercise each: type-relabel fails, cross-transaction replay fails, bit-flip fails, impersonation (same bytes, other key) fails, commit fails once its promise set changes, non-canonical base64url returns `false` (never throws).
- **Canonical encoding path.** Preimage is a `DigestValue` through the scaffold `digest()` (sha256 of DAG-CBOR); `pr` present only for `C`/`NC`, omitted (not `undefined`) for `P`/`NP`; promise set reduced to `{type,address,value}` and sorted, so permutations hash equal and a promise's `attachment` is dropped. All tested.
- **No runtime curve leak.** `@noble/curves` is in `devDependencies` and imported only by `signature.test.ts`; no `src/` runtime file imports it (sole hit is a comment in `crypto.ts`). Confirmed by grep.
- **Public surface stays atomic.** `consensus/index.ts` is not re-exported from `src/index.ts` — intentional, ships with the final ticket. Confirmed.
- **Store, trace, docs.** `MemoryTrxStore` round-trips through JSON and `canonicalEncode` (incl. a commit with an opaque `attachment`); the seven events were folded into the single `TraceEvent` union (not forked); `promise-signed` uses `signatureType` to avoid shadowing the union discriminant; design.md § *The commit attachment seam* accurately describes the liveness-not-safety property of the opaque `attachment`.
- **`SignatureRejectReason` vocabulary** (`forged`/`non-member`/`wrong-role`/`replay`/`changed`/`equivocation`/`core-mismatch`/`expired`) is complete for the participant ticket's needs; type-only import into `trace.ts`, no runtime coupling.

### Found and fixed inline (minor)
- **Topology test gap.** `digest.test.ts`'s describe block was titled "payload **and topology** are covered" but both tests varied only the payload — the topology (members array, links map) was in the signed preimage with **zero** coverage, including the design's two central claims. Added 4 tests: a changed member changes the digest; a changed link term changes the digest; the **members array is order-sensitive** (its order is the immutable core); the **links map is order-independent** (keyed by nonce). All pass; suite 13→17 for `digest.test.ts`, total 235→239.

### Scrutinized — acceptable, deferred to the participant ticket (no ticket filed)
- **The signed topology includes optional member fields** (`physical`, `secret`, `noCache`, `dependsOn`). Under the intended design (line 75–80 of design.md: the originator fixes **one** immutable topology distributed identically to every node), all nodes sign/verify identical bytes, so this is correct. It would only bite if the participant ticket let nodes populate or augment member fields *locally* after the core is set — then differing optional fields would read as `core-mismatch`. Genuinely conditional (fine now; only matters *if* local augmentation is introduced), so recorded here rather than filed. The `tallynet-consensus-participant` author should keep the transaction-time topology byte-identical across nodes.

### Empty categories (explicit)
- **No major findings** — nothing warranted a new `fix`/`plan`/`backlog` ticket. The signing/record/store surface is small, pure, and well-tested; the known gaps the implementer flagged are all genuinely downstream (merge/advance/push, referee-set/majority logic, cross-package digest vector) and belong to the dependent tickets by design, not oversights here.
- **No `blocked/` items** — no decision needs a human; no out-of-repo dependency.

### Tripwires (confirmed appropriate, parked by the implementer at each site)
- `digest.ts` `recordDigest`: absent promise set for a commit → empty-set preimage, not a throw (conditional on a future direct caller omitting it). `NOTE:` at site.
- `digest.ts` `canonicalPromiseSet`: re-maps+re-sorts the whole promise set per commit digest; memoize only if routes ever carry very large promise sets. `NOTE:` at site.
- `store.ts` `savePeerRecord`: by-reference storage; mutate-in-place after save would corrupt the next ticket's reachability skip test — the participant must save a distinct object per push. `NOTE:` at site.

## Open items carried into the dependent tickets (not defects here)
- **No cross-package digest vector** pinning `recordDigest`'s bytes against `taleus-core`'s injected `RecordDigest` — the injection point is unbound until `tallynet-bind-taleus-core`. The field layout (`k/tx/sc/pl/tp/pr`) matches the design note ("referee signs core+promises only"), but no shared test proves byte-equality across packages yet. For the binding ticket.
- Negative-majority / empty-referee-set rejection, tie→void, `isConsensus`, and the merge/advance/push state machine all live in `tallynet-consensus-participant`.
