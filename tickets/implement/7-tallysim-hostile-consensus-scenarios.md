description: Add simulator tests that stage the nastiest lift attacks — forging someone else's signature, flooding junk votes, replaying old messages, and a voter that signs "yes" to one side and "no" to the other — and prove the protocol either shrugs them off or flags the one attack it cannot (a dishonest majority of voters).
files: packages/tallysim/src/sim/consensus-harness.ts, packages/tallysim/src/sim/route.ts, packages/tallysim/src/sim/identity.ts, packages/tallysim/src/sim/harness.ts, packages/tallysim/src/sim/consensus-resource.ts, packages/tallysim/src/sim/voter-harness.test.ts, packages/tallynet/src/testing/consensus.test.ts, packages/tallynet/src/consensus/participant.ts, packages/tallynet/src/consensus/signature.ts, packages/tallysim/docs/design.md
difficulty: medium
----

<!-- resume-note
A prior implement run (2026-11-27) completed full investigation but hit the soft token budget BEFORE writing any
code. NO source files were changed — the working tree is clean of this ticket's work. The run's value is the
"## Worked implementation design" section below: a de-risked, concrete design for every file and scenario, with a
reference helper implementation and a correction to the original helper sketch. The next agent should implement
directly from that section (it already resolved the hard questions) and VALIDATE by running the tests — nothing
below has been run. Start fresh; there is no partial state to reconcile.
-->

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

---

# Worked implementation design (investigation complete — implement from here, then validate)

Everything below was verified against the current source during investigation. Build the two files, update the
doc, and run `yarn workspace tallysim test` + `yarn workspace tallysim lint`. Nothing here has been executed —
treat the outcomes as expected, confirm them, and adjust topology/assertions if a run disagrees.

## Facts pinned during investigation (so you don't re-derive)

- **Member key vs node name.** `sim.net.memberKey(name)` → the base64url ed25519 key for node `name`; it equals a
  topology member's `address.key`. Node name in the sim is `entityName(id) === String(id)`. `makeSimSigner(seed, name)`
  (`sim/identity.ts`) returns the `Signer` whose `publicKey` base64url-encodes to that member key — the sim holds every
  private key, which is what makes forging/equivocating possible with no new machinery.
- **`signRecord(signer, kind, record)`** (`tallynet`, re-exported from the package index) sets `address =
  bytesToBase64url(signer.publicKey)` and signs the preimage. A **promise** preimage does NOT depend on the promise set;
  a **commit** preimage binds `record.promises`, so a `C`/`NC` MUST be signed over the *complete-promise* record (see the
  `completeOf` pattern in `tallynet/src/testing/consensus.test.ts:632`), not the empty-signature record.
- **Trace.** `buildSimNetwork(network, conditions, seed, trace?, options?, consensus?)` — the 4th arg is a `TraceSink =
  (e: TraceEvent) => void`. Collect with `(e) => events.push(e)`. Reject reasons live on `{type:'signature-rejected',
  reason}`; the contradiction event is `{type:'contradiction-detected', ourOutcome, peerOutcome}`. Copy the
  `rejectReasons(traces)` helper from `tallynet/src/testing/consensus.test.ts:268`.
- **Pushes are scheduled timers, not immediate.** `await node.update(rec)` runs that node's merge + advance loop
  synchronously (it can settle/release in-place) but only *schedules* onward pushes as clock timers. So you can inject
  several crafted records into different nodes with sequential `await update(...)` calls and they will NOT cross-
  contaminate until you drive `clock.runUntilIdle()`. This is the lever that makes the partition scenarios controllable.
- **`detectContradiction` runs for every node** (member or relay), inside `update`, comparing OUR merged outcome against
  the RAW incoming record's outcome. `outcome()`/`recordOutcome` are role-independent. So two settled nodes that merge
  each other's opposing records flag the contradiction.
- **Reading settlement state:** `sim.net.consensusNode(String(id)).outcome(tx)` / `.equivocators(tx)` / `.contradicts(tx)`;
  pooled commits via `sim.net.consensusStoreOf(String(id)).getPendingCommits(tx)`; per-node release history via the
  handles from `makeSimResources({})` (`handle.releaseSuccesses`: `[true]`=committed once, `[false]`=voided once,
  `[]`=never).
- `net.deliveryErrors` stays `[]` on every scenario (a receiver-side rejection of a crafted record is caught by the
  engine, never thrown back to the sender). Assert it in each test. `net.clock.pendingTimers === 0` where everything
  settles to a terminal state.

## CORRECTION to the original `sim/hostile-records.ts` sketch

The original sketch said *"forge as victim is just sign as victim with the identity seed"* via a single `signAs`. **That is
wrong for the forgery invariant.** `signAs(seed, victim, 'C', rec)` uses the victim's REAL key (the sim holds it), so the
face **verifies** and would be *counted*, not rejected `forged`. A realistic forgery is a node that does NOT hold the
victim's key: it signs with its OWN key and relabels `address` to the victim. So the helper needs **two** primitives:

- `signAs(seed, name, type, rec)` — a **genuine** face in `name`'s name (both address and value are `name`'s). This is
  the primitive the **equivocation** scenarios use: the sim god-mints a voter's genuine `C` *and* genuine `NC` — exactly
  the two faces an equivocating node would itself produce — and both verify.
- `forgeFace(seed, victimKey, attackerName, type, rec)` — sign with `attackerName`'s key, then overwrite `address =
  victimKey`. The value was made by the attacker's key but claims to be the victim ⇒ `verifySignature` fails ⇒ `forged`.
  This is the primitive the **forgery** scenario uses.

## `sim/hostile-records.ts` — reference implementation (pure, no Node globals)

Platform-neutral (checked by `no-node-globals.test.ts`, which scans non-test `src/`): import only `signRecord` + types
from `tallynet`, `makeSimSigner` from `./identity.js`, `LiftTerms` from `./terms.js`. NOTE: `base64urlToBytes` /
`bytesToBase64url` are **not** exported from `tallynet`'s public index — do NOT reach for them. Make junk by mutating the
base64url `value` STRING in place (single-char swap within the base64url alphabet), which stays canonical, decodes, and
fails verification, with no decoder needed.

```ts
import { signRecord, type Signature, type SignatureType, type TrxRecord } from 'tallynet'
import { makeSimSigner } from './identity.js'
import type { LiftTerms } from './terms.js'

/** A GENUINE face of `type` as `signerName`, using that node's real key (the sim holds every key). Verifies. */
export function signAs(
	identitySeed: number, signerName: string, type: SignatureType, record: TrxRecord<LiftTerms, unknown>,
): Promise<Signature> {
	return signRecord(makeSimSigner(identitySeed, signerName), type, record)
}

/**
 * A face of `type` CLAIMING to be `victimKey` but SIGNED with `attackerName`'s key, so it fails verifySignature and is
 * rejected `forged`. Models a node forging another member's face: the attacker never holds the victim's private key.
 */
export async function forgeFace(
	identitySeed: number, victimKey: string, attackerName: string, type: SignatureType, record: TrxRecord<LiftTerms, unknown>,
): Promise<Signature> {
	const signed = await signRecord(makeSimSigner(identitySeed, attackerName), type, record)
	return { ...signed, address: victimKey } // claim the victim; value is the attacker's → verify fails
}

/**
 * `n` DISTINCT garbage commits attributed to one voter (`genuine.address`, `genuine.type`), each an invalid value, so
 * none dedupes and none verifies — the flood. One base64url char is swapped at a rotating position (stays canonical,
 * decodes, fails verification); distinct positions ⇒ distinct values.
 */
export function junkCommits(genuine: Signature, n: number): Signature[] {
	return Array.from({ length: n }, (_, i) => {
		const chars = [...genuine.value]
		const pos = i % chars.length
		chars[pos] = chars[pos] === 'A' ? 'B' : 'A' // a different valid base64url char ⇒ wrong signature
		return { ...genuine, value: chars.join('') }
	})
}
```

Caveat to verify at implementation time: the `'A'/'B'` swap must actually CHANGE the char (if `genuine.value[pos]` is
already `'B'` it maps to `'A'`, and `'A'`→`'B'`; any other char → `'A'`). Distinctness holds because distinct positions
are touched for `i < value.length`, and `MAX_PENDING_COMMITS_PER_VOTER + 1 = 5 ≪ value.length` (an ed25519 sig is 86
base64url chars). If you prefer byte-exact parity with the existing `corruptAt`, you may instead add tiny local
`base64url` encode/decode helpers, but the string-swap above needs no decoder and is simplest.

Export both files from `sim/index.ts` (add `export * from './hostile-records.js'`).

## `sim/hostile-scenarios.test.ts` — the five scenarios

Shared scaffolding (copy the shapes from `voter-harness.test.ts` / `consensus-harness.test.ts`): `IDENTITY_SEED = 7`,
`line(n, limit=1000)` and `META`, `entityName`, `rejectReasons`, a `complete(record)` helper that signs every
participant's `P` via `signAs` and returns `{...record, promises:[...]}`, and `outcomeOf(sim, id, tx)`.

### 1. Forgery (real discovered route; cover both a forged `C` and a forged `P`)
- `line(5)`, voter = terminus; attacker = a NON-member node off the route (e.g. extend to `line(6)` so node 5 exists but
  is not on the `0→4` route, or add an isolated extra entity). Build the sim with a trace collector.
- Drive the honest lift to settlement: `runQuery(0→4)` then `runLiftForOutcome` ⇒ `commit`; record `tx`.
- **Forged commit (of a voter's key):** read the settled record `const settled = await sim.net.consensusNode('0').serveRecord(tx)`
  (its promise phase is complete). `const forged = await forgeFace(SEED, sim.net.memberKey(VICTIM_VOTER_NAME), ATTACKER_NAME, 'C', settled)`.
  Push `await sim.net.consensusNode(TARGET).update({ ...settled, commits: [...settled.commits, forged] })`. Assert: target
  `outcome(tx)` unchanged (`commit`); `rejectReasons(events)` contains `'forged'`; the merged record's `commits` do not
  contain the forged value (the voter's genuine vote is the only one that counted — the attacker did not cast the voter's
  vote). `deliveryErrors` is `[]`.
- **Forged promise:** on a FRESH target node for the same `tx`, push `{...mintedRecord, promises:[forgedP], commits:[]}`
  where `forgedP = forgeFace(SEED, victimParticipantKey, ATTACKER_NAME, 'P', mintedRecord)` and `mintedRecord` is the
  topology-only record (get a minted record by calling `buildLift` directly with the same route, OR reuse `settled` with
  empty signature sets). It must yield `'forged'` (not `'changed'`): `'forged'` only arises when the victim has **no**
  prior promise in that record, so push into a node that has not yet seen the victim's genuine `P`. Assert `'forged'`
  traced and the node stays `pending` (the forged promise never entered the set).

### 2. Junk-signature flood / pool-full (real route)
- `line(3)`, route `0→2`, voter = node 2. Build sim with trace collector. Pick a TARGET to inject into. Two options,
  both fine — pick whichever runs cleanly:
  - a **member** node (e.g. node 0): simplest, but when you push junk pre-promise it will also cast its OWN `P` (does not
    affect node 2's pool cap); or
  - add a non-member observer (extend to `line(4)`, route stays `0→2`, node 3 links to node 2 but is not a lift member) —
    mirrors the `tallynet` observer-X pattern exactly (pools without promising).
- `buildLift({ members: [0=P,1=P,2=P+V], route:['0','1','2'], routeLinkIds:['T0','T1'], payload:{amount:'5'} })` → `record`, `tx`.
  `const comp = await complete(record)`. `const genuineC = await signAs(SEED,'2','C',comp)`. `const junk =
  junkCommits(genuineC, MAX_PENDING_COMMITS_PER_VOTER + 1)` (import the constant from `tallynet`).
- Delivery 1 (pre-promise): `await node(TARGET).update({ ...record, promises:[], commits: junk })`. Assert
  `sim.net.consensusStoreOf(TARGET).getPendingCommits(tx)` has length `MAX_PENDING_COMMITS_PER_VOTER`; `rejectReasons`
  contains `'pool-full'`.
- Delivery 2 (completing): `await node(TARGET).update({ ...comp, commits:[genuineC] })`; `runUntilIdle`. Assert the pooled
  junk drained (`'forged'` traced) and `outcome(tx) === 'commit'` — the cap never locked out the real vote. `deliveryErrors` `[]`.

### 3. Replay (real route)
- `line(3)`, route `0→2`, cooperative; build sim with `makeSimResources({})` so you can read `handles`. `runLiftForOutcome`
  ⇒ `commit`; capture balances and each node's `handle.releaseSuccesses` (`[true]`). Capture a delivered record:
  `const rec = await sim.net.consensusNode('0').serveRecord(tx)`.
- Re-push after settlement: `await sim.net.consensusNode('0').update(rec)` (and optionally into another node). `runUntilIdle`.
  Assert every node's `releaseSuccesses` is STILL `[true]` (released exactly once — idempotent), `outcome` unchanged,
  `network.tallies[*].balance` unchanged, `deliveryErrors` `[]`, `pendingTimers` 0.

### 4 & 5. Equivocation — shared partition scaffold (the hard part — read carefully)

Both equivocation scenarios use ONE topology and ONE mechanism; only the face-set differs.

- Topology: `line(5)` `0—1—2—3—4`. Lift members = all five on route `[0,1,2,3,4]`, voters = **{1,2,3}** (3-voter set),
  others `[P]`. Build sim with a trace collector. `buildLift({...route [0..4], routeLinkIds:['T0','T1','T2','T3'], payload})`
  → `record`, `tx`. `const comp = await complete(record)` (all five `P`).
- Partition with the **live conditions map**: `sim.conditions[linkIdForTally(2)] = { drop: true }` BEFORE driving — this
  splits the line into island **L = {0,1,2}** and island **R = {3,4}** (exactly the split-test mechanism,
  `voter-harness.test.ts:180`).
- Craft two self-contained complete records (each carries all five promises + a full commit set), push one into island L
  (via node 0) and one into island R (via node 4), then `runUntilIdle`. Because `T2` is dropped, L's pushes reach only
  {0,1,2} and R's reach only {3,4}; each island settles on its injected faces independently. Then **heal**
  (`delete sim.conditions[linkIdForTally(2)]`) and `runUntilIdle` — the records now cross `T2` and the merge/contradiction
  logic fires.

**Scenario 4 — honest majority (equivocator = node 2; honest voters 1, 3):**
- `cL = { ...comp, commits:[ signAs(1,'C'), signAs(3,'C'), signAs(2,'C') ] }` (abbreviating `signAs(SEED, name, type, comp)`).
- `cR = { ...comp, commits:[ signAs(1,'C'), signAs(3,'C'), signAs(2,'NC') ] }`.
- Both records are COMMIT-majority (two honest `C` = 2 of 3 → strict majority). Push `cL`→node 0, `cR`→node 4; `runUntilIdle`.
  Assert island L ({0,1,2}) and island R ({3,4}) all `commit`.
- Heal; `runUntilIdle`. Now node 2's two faces (`C` from L, `NC` from R) meet at some node ⇒ that node retains proof.
  Assert: every node still `commit`; `equivocators(tx)` on a node that saw both faces (check node 2, and/or node 0 after
  propagation) lists `sim.net.memberKey('2')`; `equivocationProof(tx, memberKey('2'))` has length 2; `contradicts(tx) ===
  false` everywhere (both faces were commit-majority, so no node ever saw a void record). `deliveryErrors` `[]`, `pendingTimers` 0.

**Scenario 5 — equivocating MAJORITY (equivocators = nodes 1 AND 2, 2 of 3; honest voter 3) — the documented boundary:**
- `cL = { ...comp, commits:[ signAs(3,'C'), signAs(1,'C'), signAs(2,'C') ] }` → 3 `C` → **commit**.
- `cR = { ...comp, commits:[ signAs(3,'C'), signAs(1,'NC'), signAs(2,'NC') ] }` → 1 `C` + 2 `NC` → **void** majority.
- Push `cL`→node 0, `cR`→node 4; `runUntilIdle` (still split). Assert island L all `commit`, island R all `void` — a
  genuine **inconsistent settlement** (the attack the protocol cannot mask).
- Heal; `runUntilIdle`. The opposing records cross `T2`: a committed node merges the raw void record (keeps its first
  commit faces, retains the `NC`s as proof) and `detectContradiction` fires. Assert `contradicts(tx) === true` on at least
  the boundary nodes (2 and 3), and `events` contains a `{type:'contradiction-detected'}`. **Comment this clearly as the
  expected, documented failure** — the boundary the parent plan names. `deliveryErrors` stays `[]` (the equivocation
  rejections are caught, not thrown).

Determinism guard (matches the existing style): wrap each scenario's core in a `pass()` closure (re-`cloneNetwork`, same
seed), run twice, and assert identical `outcome`/`equivocators`/`contradicts` and byte-identical `serialize(network)` /
`rejectReasons`. Same `identitySeed` + seeds ⇒ same keys ⇒ same signatures ⇒ same trace.

## Edge cases the design already covers (verify in the run)
- **A hostile node that is also a voter.** Forgery *of* a voter's key (scenario 1, forged `C` attributed to a voter) and a
  voter that itself equivocates (scenarios 4/5) are both covered.
- **Several colluding.** Scenario 5 (2 of 3) is collusion; the odd 3-voter set makes "majority" unambiguous.
- **Promise-phase vs commit-phase injection.** Scenario 2 hits the pre-promise **pool** path; scenario 1's forged `C`
  hits the post-complete **promote** path; scenario 1's forged `P` hits the promise merge path. All three orderings exercised.
- **Circular vs linear.** All scenarios above are linear; note (don't necessarily test) that a circular route lists its
  origin once in `members` — crafted records must respect `liftMembers`.
- **`net.deliveryErrors` stays `[]`** — asserted in every scenario, so a crafted push that *throws* surfaces as a regression.

## TODO (for the next run)
- Add `sim/hostile-records.ts` per the reference implementation above; export it from `sim/index.ts`.
- Add `sim/hostile-scenarios.test.ts` with the five scenarios + the determinism guard.
- Run `yarn workspace tallysim test 2>&1 | tee /tmp/tallysim-test.log` and `yarn workspace tallysim lint 2>&1 | tee /tmp/tallysim-lint.log` until green; confirm `no-node-globals.test.ts` still passes (the new source file is neutral — the `.test.ts` is excluded from the scan).
- Add a short `### Hostile-actor scenarios` subsection under `## Consensus simulation` in `packages/tallysim/docs/design.md`: name the five invariants, where they live, that active-emission attacks are validated by **hand-driven scenarios** (not swept) because feeding divergent faces needs mid-drive partitioning, and that the single inconsistent-settlement case is a voter *majority* equivocating — matching the protocol's own `detectContradiction` limit.
- Write the `review/` handoff honestly: flag that the equivocation scenarios inject the equivocator's faces as crafted
  records (the sim god-mints both genuine faces) rather than driving a node that natively double-signs, and that the
  "which node retains the proof after heal" assertion depends on propagation order — pin it to a specific node and note it.

## End
