description: Add simulator tests that stage the nastiest lift attacks — forging someone else's signature, flooding junk votes, replaying old messages, and a voter that signs "yes" to one side and "no" to the other — and prove the protocol either shrugs them off or flags the one attack it cannot (a dishonest majority of voters).
files: packages/tallysim/src/sim/consensus-harness.ts, packages/tallysim/src/sim/route.ts, packages/tallysim/src/sim/identity.ts, packages/tallysim/src/sim/harness.ts, packages/tallysim/src/sim/consensus-resource.ts, packages/tallynet/src/testing/consensus.test.ts, packages/tallynet/src/consensus/participant.ts, packages/tallynet/src/consensus/signature.ts, packages/tallysim/docs/design.md
difficulty: medium
----

## What this is

The parent plan (`7-tallysim-hostile-actors`) splits into four implement tickets, prereq-chained:

1. **this ticket** — hand-driven scenario tests proving the protocol's own defences hold against *active-emission* attacks (forge / flood / replay / equivocate), over **real reconstructed routes** at simulator scale, plus the reusable helper that mints the malicious records.
2. `tallysim-multivoter-and-vote-no` — the *swept* measurement machinery: multi-voter sets, a no-commit-voter dial, and the inconsistent-settlement / equivocator metrics.
3. `tallysim-hostile-experiment-and-findings` — the checked-in experiment comparing consensus methods under attack, the recommendation, and the design-doc write-up.
4. `tallysim-viewer-hostile-markers` — the viewer marks hostile nodes and shows where a lift breaks.

This first ticket needs **no new protocol code and no new `tallynet`**. Everything is already in place:

- `tallynet` already *defends* against these attacks and unit-tests the defences at the single-participant level (`packages/tallynet/src/consensus/participant.test.ts`: `forged`, `pool-full`, `equivocation`, `contradiction-detected`) and at the whole-network level (`packages/tallynet/src/testing/consensus.test.ts`: the pre-promise equivocation and pool-cap scenarios). The participant re-verifies every commit (`countVerifiedCommits`), so a forged vote is counted by nobody; the side pool caps unverified commits at `MAX_PENDING_COMMITS_PER_VOTER` (= 4) per voter; and an equivocating signer's two faces are retained as proof while the earliest-seen face is the one that stands.
- The simulator holds every node's **private key** deterministically — `makeSimSigner(identitySeed, name)` in `sim/identity.ts` — so it can mint a signature for *any* node (the essence of forgery) without new machinery.
- `tallynet` exports `signRecord` / `verifySignature` (from `./consensus/index.js`, re-exported by the package index) for building signed faces by hand.
- A `ConsensusNode` exposes `update(record)`, `outcome(tx)`, `equivocators(tx)`, `equivocationProof(tx, signerKey)`, and `contradicts(tx)` (`packages/tallynet/src/consensus/engine.ts`) — everything a test needs to inject a crafted record and read the result.
- `reconstructRoute(network, sessionCode, from, plan)` (`sim/route.ts`) turns a found plan into a concrete `{ tallyPath, route }`, and `runLiftForOutcome` (`sim/consensus-harness.ts`) builds the real `LiftSpec`/record. A scenario test drives a *real* discovered route rather than a toy two-node graph, which is the value this adds over the existing `tallynet` unit tests.

So the work is: a small sim helper that mints the malicious records from the sim's known identities + a built network, and a scenario test file that stages each attack against a real route and asserts the invariant.

## The invariants under test

| Attack | What the attacker does | Expected result |
|---|---|---|
| **Forgery** | A node signs a commit (`C`) or promise (`P`) **with another member's key** and pushes it. | Outcome unchanged. The forged face fails `verifySignature`, is rejected `forged`, and never counts. No member's real outcome moves. |
| **Junk-signature flood** | A node pushes `MAX_PENDING_COMMITS_PER_VOTER + 1` distinct garbage commits attributed to one voter, before the promise phase completes. | The side pool holds exactly `MAX_PENDING_COMMITS_PER_VOTER`; the overflow is rejected `pool-full`; the voter's **genuine** vote, delivered after, still counts and the lift settles normally. |
| **Replay** | A node re-pushes a record (or a settled face) it already delivered. | Idempotent — deduped silently; outcome and release count unchanged. |
| **Equivocating voter, honest majority** | One voter in a set of ≥ 3 signs `C` to part of the network and `NC` to another part. | Every honest member still settles the **same** way (the majority's). The equivocator is listed by `equivocators(tx)`; `equivocationProof` holds both faces. No inconsistent settlement. |
| **Equivocating voter *majority*** | A *majority* of the voter set equivocates (e.g. 2 of 3 sign both faces, feeding opposite faces to two partitions). | This is the **one** attack the protocol cannot mask: two honest members can settle opposite ways. The test asserts the contradiction **is detected** (`contradicts(tx) === true`, a `contradiction-detected` trace event) — recorded as the **expected, documented failure**, the boundary the parent plan names ("zero inconsistent settlements *unless a voter majority equivocates*"). |

The equivocation scenarios are necessarily **hand-driven** (not through `runLiftForOutcome`): feeding different faces to different partitions means flipping link conditions or pushing crafted records mid-drive, which the atomic `start` + single `runUntilIdle` cannot express. This mirrors the existing hand-driven pattern in `packages/tallysim/src/sim/voter-harness.test.ts` (the network-split scenario) and `tallynet`'s `testing/consensus.test.ts`. Use `SimNetwork.conditions` (the live per-link map `buildSimNetwork` returns) to partition the network mid-drive exactly as the split/rejoin test does.

## New helper: `sim/hostile-records.ts`

A small, pure, platform-neutral module (no Node globals — it is checked by `no-node-globals.test.ts`) that mints malicious records from the sim's deterministic identities. Sketch of the surface (adjust names/signatures to fit during implementation):

```ts
// Mint a signed face (P/NP/C/NC) AS `signerName`, using that node's deterministic key. The sim knows
// every private key, so "forge as victim" is just "sign as victim with the identity seed".
function signAs(identitySeed: number, signerName: string, type: SignatureType,
                record: TrxRecord<LiftTerms, unknown>): Promise<Signature>

// A record carrying a forged face attributed to `victimName` but the lift is otherwise genuine —
// for pushing into a target node via `net.consensusNode(target).update(forged)`.
function forgedCommitRecord(...): Promise<TrxRecord<LiftTerms, unknown>>

// N distinct garbage commits attributed to one voter (distinct byte flips, so none dedupes) — the flood.
function junkCommits(genuine: Signature, n: number): Signature[]
```

Reuse `signRecord` from `tallynet` and `makeSimSigner`/`signerForSeed` from `sim/identity.ts`; do not inline a second signer. Keep the *malice* here in the simulator — `tallynet` stays the honest protocol. This helper is reused by ticket 2's metrics validation.

## TODO

- Add `sim/hostile-records.ts`: `signAs` (mint a face as any node via its deterministic key), a forged-record builder, and the junk-commit generator. Pure, no Node globals.
- Add `sim/hostile-scenarios.test.ts` driving a **real** discovered route (build a small network, `runQuery`, `reconstructRoute`, `buildLift`) and staging each attack:
  - **Forgery**: drive the honest lift to settlement; separately push a forged `C`/`P` (signed as a member by a non-member) into a target node's `update`; assert `outcome` unchanged for every member, a `forged` rejection traced, and (for a forged vote) `countVerifiedCommits` ignored it.
  - **Flood**: reproduce the `pool-full` invariant over a real route — push `MAX_PENDING_COMMITS_PER_VOTER + 1` junk commits for one voter pre-promise, then the genuine completing promise + real vote; assert pool length caps, `pool-full` traced, lift still commits.
  - **Replay**: capture a pushed record from the trace/`serveRecord`, re-`update` it after settlement; assert idempotent (`releaseSuccesses` unchanged, outcome unchanged).
  - **Equivocation, honest majority**: a ≥ 3-voter set (hand-built members), one voter fed `C` to one partition and `NC` to another via the live `conditions` map; assert all honest members agree, `equivocators(tx)` lists the one, `contradicts(tx) === false`.
  - **Equivocation majority**: 2-of-3 voters equivocate across a partition; assert `contradicts(tx) === true` and a `contradiction-detected` event — the expected failure. Comment it clearly as the documented boundary.
- Assert **determinism**: each scenario replays byte-identically (same `identitySeed` + seeds ⇒ same keys, signatures, outcome). Run the test twice in-process or snapshot the relevant event stream, following the determinism style already used in the sim tests.
- `yarn workspace tallysim test` and `yarn workspace tallysim lint` green; `no-node-globals.test.ts` still passes (the new source file is neutral).
- Add a short `### Hostile-actor scenarios` subsection under `## Consensus simulation` in `packages/tallysim/docs/design.md`: name the five invariants, where they live, and that active-emission attacks are validated by **hand-driven scenarios** (not swept) because feeding divergent faces needs mid-drive partitioning. State plainly that the single inconsistent-settlement case is a voter *majority* equivocating, matching the protocol's own `detectContradiction` limit.

## Edge cases & interactions

- **Determinism under the seed holds with crafted records.** Minting a forged/equivocating face must draw from the identity seed only (`makeSimSigner`), never a shared RNG, or it will shift session-code minting. Assert a twice-run scenario is byte-identical.
- **A hostile node that is also a voter.** Forgery *by* a voter vs. forgery *of* a voter's key are different; cover a voter whose key is forged by someone else (must not let the attacker cast the voter's vote) and a voter that itself equivocates.
- **Several colluding.** The majority-equivocation scenario *is* collusion (2 of 3). Keep the voter set small and odd so "majority" is unambiguous.
- **Forged-vote side pool and its cap are exercised and shown to hold** — the flood scenario is exactly this, over a real route rather than a two-node stub.
- **Circular vs linear route.** Stage at least the forgery scenario on a linear route; note (don't necessarily test) that a circular route lists its origin once in `members` — crafted records must respect that, matching `liftMembers`.
- **Promise-phase vs commit-phase injection.** A pre-promise junk commit lands in the side pool (`pool-full` path); a post-complete one goes straight through `promoteCommit` (`forged`/`changed`/`equivocation`). Cover both arrival orderings so the test does not accidentally only hit one path.
- **`net.deliveryErrors` stays `[]`.** A receiver-side rejection of a crafted record is caught by the engine, never thrown back to the sender; assert the clean-delivery-errors invariant the existing consensus tests rely on, so a crafted push that *throws* is caught as a real regression.
