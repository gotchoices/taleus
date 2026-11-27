description: Review new simulator tests that stage lift attacks — forged signatures, junk-vote floods, replays, and voters who sign "yes" and "no" at once — and confirm the protocol shrugs each one off, flagging only the attack it genuinely cannot mask.
prereq:
files: packages/tallysim/src/sim/hostile-records.ts, packages/tallysim/src/sim/hostile-scenarios.test.ts, packages/tallysim/src/sim/index.ts, packages/tallysim/docs/design.md
difficulty: medium
----

## What landed

Two new files + two small edits, no protocol changes. All green on the implementer's run:
`yarn workspace tallysim test` → **455/455** (36 suites), the 7 new tests among them; `yarn workspace tallysim lint` → clean. These were run once at implement time — treat them as a floor, not a finish line.

- **`packages/tallysim/src/sim/hostile-records.ts`** (new, platform-neutral — passes the `no-node-globals` scan): three primitives that mint malicious records from the sim's own deterministic keys.
  - `signAs(seed, name, type, record)` — a **genuine** face in `name`'s name, signed with that node's real key. It VERIFIES. The equivocation scenarios use it to god-mint the two faces a double-signing voter would itself emit.
  - `forgeFace(seed, victimKey, attackerName, type, record)` — signs with the attacker's key, then relabels `address` to the victim. The value was made by the attacker but claims the victim ⇒ `verifySignature` fails ⇒ rejected `forged`.
  - `junkCommits(genuine, n)` — `n` distinct invalid commits for one voter, each a single base64url-char swap of the value (stays canonical, decodes, fails verification; distinct positions ⇒ distinct values). No byte decoder needed.
- **`packages/tallysim/src/sim/hostile-scenarios.test.ts`** (new): five attack scenarios + one determinism test (7 tests).
- **`packages/tallysim/src/sim/index.ts`**: exports `./hostile-records.js`.
- **`packages/tallysim/docs/design.md`**: new `### Hostile-actor scenarios` subsection under `## Consensus simulation`.

## The five invariants under test (what to validate)

| Scenario (test) | Attack | Asserted result |
|---|---|---|
| Forged commit | A commit forged in the terminus voter's name, pushed into the committed originator over a **real discovered route** (`runQuery` 0→4, `line(5)`). | `forged` traced; originator outcome stays `commit`; the forged value never enters `commits`; `deliveryErrors` `[]`, `pendingTimers` 0. |
| Forged promise | A promise forged in a participant's name, delivered into an isolated observer that holds no genuine promise for the victim. | `forged` traced (not `changed`); observer's promise set stays empty; observer stays `pending`. |
| Junk flood | `MAX_PENDING_COMMITS_PER_VOTER + 1` (= 5) junk commits for one voter, pre-promise, into an isolated observer. | Pool holds exactly 4; the 5th drops `pool-full`; after the genuine vote + complete promises, the junk drains `forged` and the lift `commit`s. |
| Replay | A settled committed record re-pushed into the originator (real route, `makeSimResources`). | Each member still `releaseSuccesses === [true]` (one release); outcome and all tally balances unchanged; `pendingTimers` 0. |
| Equivocating voter, honest majority | Node 2 of voters {1,2,3} signs `C` to island L and `NC` to island R (both commit-majority), split via the live-conditions seam. | All five `commit`; `equivocators(2) === [memberKey('2')]`; `equivocationProof` length 2; `contradicts(2) === false`. |
| Equivocating **voter majority** (the boundary) | Nodes 1 AND 2 equivocate (honest voter 3); island L commits, island R voids. | Genuine inconsistent settlement; after healing + explicit cross-push, `contradicts(2) === true` and `contradicts(3) === true`; a `contradiction-detected` event; equivocators at a boundary node = {1, 2}. |

Plus a determinism test re-running the voter-majority scenario twice and asserting identical reject reasons / contradiction / equivocators (same seed + same keys ⇒ byte-identical).

## Known gaps / things to scrutinize (be adversarial here)

- **The equivocation is god-minted, not natively double-signed.** The sim mints both of the equivocator's genuine faces (`signAs`) and injects them as crafted records; no node's own resource is driven to double-sign. This is an honest limitation: it proves the *merge/detection* side (proof retention, `contradicts`), not that a real misbehaving participant's own `castCommit` can be induced to emit two faces. If the reviewer wants the latter, it is a larger change (a resource that signs opposite faces on different deliveries) — worth a `backlog/debt-` ticket, not an inline fix.
- **Boundary crossing is explicit, by necessity.** A dropped push is never re-queued (`network.ts:619`), so after healing the split a *settled* node does **not** spontaneously re-push across the restored link — "heal + `runUntilIdle`" alone crosses nothing. The scenarios therefore cross the boundary with an explicit `serveRecord` → `update`, which also **pins which node** sees both faces (node 2 for scenario 4; nodes 2 and 3 for scenario 5). This differs from the split/rejoin test in `voter-harness.test.ts`, which heals *pending* nodes (they still hold live recovery timers). Confirm the pinning is sound and that no assertion silently depends on propagation order beyond the explicit cross.
- **Isolated observers for clean injection.** Forged-promise and flood deliver into an isolated (edge-less) observer node — the tallysim analogue of `tallynet`'s edge-less observer `X` — so the receiver classifies but never casts a promise of its own or pushes onward. The forged-*commit* case instead pushes into the committed originator (a real member) because that is the realistic post-settlement target. Check these choices don't dodge a case worth covering (e.g. a forged commit injected *mid-promise-phase* into a member, which routes through the pool path rather than the promote path).
- **Determinism coverage is one representative scenario**, not all five. The others rely on the same seed/key determinism but are not each re-run.
- **No tripwires filed as code `NOTE:`s.** The one conditional concern (the dropped-push / explicit-cross-push rationale) is documented in prose in the test's module header and the design doc rather than a code-site `NOTE:`, because it is a test-design decision, not a latent code concern. The pre-existing `countVerifiedCommits` re-verification cost already carries its own `NOTE:` in `tallynet/src/consensus/participant.ts:731`.

## Context for the chain

This is ticket 1 of 4 from the parent plan `tallysim-hostile-actors`. It deliberately adds **no** new protocol code and **no** `tallynet` changes — it exercises defences that already exist and are unit-tested at the single-participant / whole-network level in `tallynet`. The downstream prereq-chained tickets (`tallysim-multivoter-and-vote-no`, then `tallysim-hostile-experiment-and-findings`, then `tallysim-viewer-hostile-markers`) build the swept measurement machinery, the checked-in experiment, and the viewer markers on top of these hand-driven proofs.

## Review findings

(for the reviewer to fill)
