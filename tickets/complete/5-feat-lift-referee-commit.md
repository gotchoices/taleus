description: Built the "commit" half of a lift — each device pledges the agreed amount on its shared ledgers, then the agreed arbiter (the referee) signs one all-or-nothing decision that finalizes every pledge or cancels them all. ChipNet and the database engine are still stubbed, so this is wired and tested against in-memory stand-ins.
files: src/lift/digest.ts, src/lift/referee.ts, src/lift/commit.ts, src/lift/test-harness.ts, src/lift/agent.ts, src/lift/index.ts, src/lift/digest.test.ts, src/lift/referee.test.ts, src/lift/commit.test.ts, schema/draft1.qsql (read), schema/portfolio.qsql (read), docs/architecture.md
----

# Complete: lift referee commit (the commit half of the lift agent)

Implemented and reviewed `feat-lift-referee-commit`. The pledge → commit → consensus → settle
flow: an issuer-signed `PendingLift` per owned edge, a single referee's atomic decision, and a
finalize `Ledger` row (commit) or `LiftVoid` (void) copying the referee's per-edge signature.
ChipNet and Quereus are injected ports, tested against in-memory schema-emulating doubles.

## What landed (unchanged from implement)

- **`src/lift/digest.ts`** — the cross-primitive digest contract: type-tag + u32be-length
  field encoding then sha256, `liftTermsDigest` = `Digest(Cid, LiftId, RefereeKey, Issuer,
  Units, Date, Expiry)`, `liftVoidDigest` = `Digest(Cid, LiftId, 'void')`, hex codec, sign/verify.
- **`src/lift/referee.ts`** — `SingleReferee` (set size 1): ChipNet record signature + one
  per-edge Taleus signature `{ LiftId → sig }`; refuses a mismatched referee / duplicate `LiftId`.
- **`src/lift/commit.ts`** — `pledgeEdge`, the `EdgeStrand`/`ConsensusEngine` ports,
  `applyResolution`, the idempotent verifying `LiftParticipant`, the `LiftCommit` driver, `rebuildEdgePhase`.
- **`src/lift/test-harness.ts`** — `InMemoryTally`, `ScriptedConsensusEngine`, `identity`/`referee`.
- **`src/lift/agent.ts`** — `LiftState` extended with `pending`/`committed`/`timedout`.
- **`docs/architecture.md`** — § Referee model (per-edge `LiftId`), § State mapping (landed files).

## Review findings

Read the implement diff (commit 2102408) against the schema and crypto layer, scrutinized digest
byte-parity, the settlement/idempotency/equivocation logic, and every touched file. `yarn build` /
`yarn lint` clean; `yarn test` green — **105 tests (was 103; +2 for the fixes below)**.

**Verified correct (checked, no change needed):**
- **Digest field order matches the schema exactly.** `liftTermsDigest` ↔ `PendingLift.SignatureValid`
  / `Ledger.LiftFinalize` `Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry)`
  (draft1.qsql:921, :852); `liftVoidDigest` ↔ `RefereeVoidValid` `Digest(Cid, LiftId, 'void')`
  (:968). Field types (all text except integer `Units`) align with the schema columns.
- **Commit/void digests are distinct** — no cross-replay; strand re-verifies against the pledge's
  stored `RefereeKey`, so the strand (not the agent pre-check) is the authoritative gate. A
  substituted-referee record passes the agent verify but the strand rejects it — defense-in-depth,
  design-intended.
- **Idempotency** via `status()` and persistent `seenDecisions` is retry-safe; `rebuildEdgePhase`
  reads the strand, not the journal.

**Minor findings — fixed inline this pass:**
1. **`hexToBytes` was a lax parser** (digest.ts). `Number.parseInt('0g',16)===0`, `parseInt(' a',16)===10` —
   a valid leading nibble + junk trailing char was silently accepted (junk bytes decoded, not
   rejected). Fail-closed for verification, but violates AGENTS.md "no half-baked janky parsers".
   Rewrote as per-nibble validation (`hexNibble`); added tests for `'0g'`/`'a!'`/`' a'`.
2. **Equivocation check ran before signature verify** (commit.ts `applyToEdge`). A forged/corrupt
   opposite-decision record (e.g. a tampered void after a real commit) tripped the `CONTRADICTION`
   log and `skipped-contradiction` outcome — falsely blaming an honest referee for equivocation,
   triggerable by anyone who can deliver a record. Reordered: verify first, so only a *verified*
   opposite decision counts as equivocation. Added a test asserting a forged contradicting record
   is `skipped-unverified` with no `CONTRADICTION` log and the commit standing.
3. **Strand-rejected settle writes were mislabeled** (commit.ts catch path). A racing/rejected
   finalize returned `applied: 'skipped-unverified'` and a rejected void `'skipped-contradiction'` —
   conflating strand races with signature failures / equivocation, inflating those counters for an
   observer. Added a dedicated `skipped-error` outcome (carries `error`); catch now uses it.

**Major findings → new tickets:** none. The deferred work (multi-referee recovery, timeout release)
was already filed in `backlog/` by the implement stage and is referenced, not re-created.

**Tripwires (conditional; parked at site, not filed):**
- Digest byte layout must be reconciled with the runner's `Digest()` when it lands — `NOTE:` at
  top of digest.ts, pinned by digest.test.ts so drift is caught.
- Single-referee equivocation is *detected + logged* but recovery is not built — `NOTE:` at
  `SingleReferee`, points at `backlog/feat-multi-referee-consensus`.
- ChipNet whole-record commit-digest preimage is a stand-in — `NOTE:` at `RecordDigest` and harness `resolve`.
- Wire serialization encodes `units` as a decimal string (JSON has no bigint) — the transport body
  boundary is where the real encode/decode shim lands.

**Pre-existing failures:** none surfaced; nothing written to `.pre-existing-error.md`.

## Honest gaps carried forward (need a live runner / live node)

- No live Quereus runner, no live ChipNet: `InMemoryTally` *emulates* the schema's lift gates; this
  is agent-layer parity, not proof against real Quereus inserts. Re-run pledge → reserved-vs-settled →
  finalize → void → mutual-exclusion → credit-gate flows against a runner when one exists.
- Soft-under-concurrency isolation (two finalizers, or finalize racing void) is not modeled — rides
  the open Optimystic-snapshot question flagged across the schema.
- Transport wiring is a thin unbuilt adapter (`LiftParticipant.ingest` vs `RecordParticipant`,
  contravariant param); deferred to the first live-cadre-node ticket, as `feat-chipnet-transport` deferred its live binding.
- Timeout-void liveness: the driver routes a timeout to the `timedout` journal state, but bounded
  party-driven release is `backlog/feat-lift-timeout-release` (referenced, not built).

## End
