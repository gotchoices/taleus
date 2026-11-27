description: Added simulator tests that stage lift attacks — forged signatures, junk-vote floods, replays, and voters who sign "yes" and "no" at once — and confirmed the protocol shrugs each one off, detecting only the one attack it genuinely cannot mask.
prereq:
files: packages/tallysim/src/sim/hostile-records.ts, packages/tallysim/src/sim/hostile-scenarios.test.ts, packages/tallysim/src/sim/index.ts, packages/tallysim/docs/design.md
difficulty: medium
----

## What landed

Two new files + two small edits, **no protocol changes**:

- `packages/tallysim/src/sim/hostile-records.ts` (new, platform-neutral) — three primitives that mint
  malicious consensus records from the sim's own deterministic keys: `signAs` (a genuine face),
  `forgeFace` (a face claiming a victim but signed by an attacker ⇒ fails verification), `junkCommits`
  (distinct unverifiable commits for one voter via single-char base64url swaps).
- `packages/tallysim/src/sim/hostile-scenarios.test.ts` (new) — five attack scenarios + a determinism
  test (7 tests).
- `packages/tallysim/src/sim/index.ts` — exports `./hostile-records.js`.
- `packages/tallysim/docs/design.md` — new `### Hostile-actor scenarios` subsection.

This is ticket 1 of 4 from parent plan `tallysim-hostile-actors`; downstream tickets
(`tallysim-multivoter-and-vote-no` → `tallysim-hostile-experiment-and-findings` →
`tallysim-viewer-hostile-markers`) build measurement, a checked-in experiment, and viewer markers on
top of these hand-driven proofs.

## Review findings

**Validation run (not just trusting the implementer's floor):**
- `yarn workspace tallysim lint` → exit 0, clean.
- `yarn workspace tallysim test` → **455/455** (36 suites), the 7 new tests among them. No
  pre-existing failures surfaced; no `.pre-existing-error.md` written.

**Correctness — the attacks were checked against tallynet's actual logic, not the handoff's prose:**
- The forgery asymmetry the design doc asserts is real and matches the code: a forged **commit** is
  verified-before-dedupe (`promoteCommit`, `participant.ts:557-572`), so it drops `forged` regardless of
  a genuine commit; a forged **promise** is dedupe-before-verify (`mergeSignature`, `:494-507`), so it
  reads `forged` only with no prior promise (else `changed`). The two tests exercise exactly those
  branches.
- The equivocation vote arithmetic is sound against the default `1/2` strict-majority threshold
  (`settles = count*2 > totalWeight`, `:691`): honest-majority island R (2C/1NC of 3 voters) commits;
  voter-majority island R (1C/2NC) voids — the genuine inconsistent settlement the boundary test needs.
- `junkCommits` produces `n` values each differing from the genuine and from each other (one char
  changed at a rotating position; distinct for `n ≤ 86`), so the pool-cap flood is genuinely distinct
  garbage, not accidental dedupes.
- `forgeFace` relabels `address` after signing with the attacker's key; verification fails against the
  victim's key under every reading of whether the digest binds the address — so `forged` is guaranteed.

**Coverage reviewed across angles (happy/edge/error/regression/interaction):**
- Happy-path defence (forgery/replay shrugged off), the detection boundary (voter-majority
  contradiction), edge (pool cap at `MAX_PENDING_COMMITS_PER_VOTER`), idempotency (replay: one release,
  no balance move), and determinism (one representative scenario re-run) are all covered.
- Forged `NP`/`NC` (negative faces) are **not** separately tested, but they traverse the identical merge
  code paths as forged `P`/`C` (the promise bucket treats `P`/`NP` alike; `promoteCommit` verifies `C`
  and `NC` alike) — no distinct behaviour left untested. Not a gap.
- A forged commit injected **mid-promise-phase** into a member routes through the pool path, which the
  junk-flood test already exercises (unverifiable commits pool then drain `forged`) — functionally
  equivalent, not a gap.

**Source hygiene:** `hostile-records.ts` is 73 lines of small, single-purpose functions with clear,
concise doc comments; the test file's heavy commenting is justified by the subtlety of each staged
attack. Platform-neutral (`no-node-globals` guard passed in the suite). Docs read accurately against the
new reality.

**Dispositions:**
- *Minor (fixed inline):* none — nothing required fixing.
- *Major (new ticket):* one — `backlog/debt-tallysim-native-double-sign-resource.md`. The equivocation
  scenarios **god-mint** both of a cheating voter's faces rather than driving a node that natively
  double-signs; this proves detection/merge, not that a real `castCommit` can be induced to emit two
  faces. It is only *debt* (tallynet already unit-tests native equivocation at the participant level),
  so the ticket is low-priority and additive — implementer flagged it themselves.
- *Tripwire (no ticket):* none newly filed. The one conditional concern (a dropped push is never
  re-queued, so the boundary must be crossed with an explicit `serveRecord` → `update`) is already
  documented in the test's module header and the design doc; it is a test-design rationale, not a latent
  code concern. The pre-existing `countVerifiedCommits` re-verification cost already carries its own
  `NOTE:` at `participant.ts` (`:731` / `:916`).
