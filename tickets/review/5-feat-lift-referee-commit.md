----
description: Built the "commit" half of a lift — each device pledges the agreed amount on its shared ledgers, then the agreed arbiter (the referee) signs one all-or-nothing decision that either finalizes every pledge or cancels them all. ChipNet and the database engine are still stubbed, so this is wired and tested against in-memory stand-ins.
files: src/lift/digest.ts (new), src/lift/referee.ts (new), src/lift/commit.ts (new), src/lift/test-harness.ts (commit doubles appended), src/lift/agent.ts (LiftState extended), src/lift/index.ts (exports), src/lift/digest.test.ts (new), src/lift/referee.test.ts (new), src/lift/commit.test.ts (new), schema/draft1.qsql (PendingLift/Ledger LiftFinalize/LiftVoid — read, not changed), schema/portfolio.qsql (LiftJournal — read, not changed), docs/architecture.md (§ Referee model and the commit seam, § State mapping)
----

# Review: lift referee commit (the commit half of the lift agent)

Implements `feat-lift-referee-commit`. Consumes the selected `LiftPlan` from
`feat-lift-agent-discovery` and runs the pledge → commit → consensus → settle flow: write an
issuer-signed `PendingLift` on each owned edge, have the single referee sign one decision, and
copy the referee's per-edge signature into a finalize `Ledger` row (commit) or a `LiftVoid`
(void). **The reviewer should treat the tests as a floor and the port boundaries as the main
risk surface — read § "Honest gaps" first.**

## What landed

- **`src/lift/digest.ts`** — the **cross-primitive digest contract** (the make-or-break). A
  canonical, collision-proof field encoding (type tag + u32be length prefix per field, then
  sha256) with `liftTermsDigest` = `Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date,
  Expiry)` and `liftVoidDigest` = `Digest(Cid, LiftId, 'void')`, plus a hex codec for the
  text key/signature boundary and `sign*/verify*` helpers that mirror the schema's
  `SignatureValid()` form. **This file DEFINES the byte layout** — the schema's `Digest()` is a
  host-registered scalar with no runner yet, so there is nothing to match against; the layout
  must be reconciled with the runner's `Digest()` when it lands (a `NOTE:` says so, mirroring
  `computeNonce`).
- **`src/lift/referee.ts`** — `SingleReferee` (set size 1). `commit`/`void` each emit the
  ChipNet whole-record signature **and** one per-edge Taleus signature (`{ LiftId → sig }`).
  Refuses to sign an edge naming a different referee; refuses a duplicate `LiftId`.
- **`src/lift/commit.ts`** — the pledge writer (`pledgeEdge`), the `EdgeStrand` /
  `ConsensusEngine` ports that back ChipNet's `TrxParticipantState`/`TrxParticipantResource`,
  the settlement core (`applyResolution`), the idempotent signature-verifying `LiftParticipant`
  (the transport's `RecordParticipant`), the originator `LiftCommit` driver, and
  `rebuildEdgePhase` (crash/restart reads the strand, not the journal).
- **`src/lift/test-harness.ts`** — commit doubles appended: `InMemoryTally` (a **schema-
  emulating** `EdgeStrand`), `ScriptedConsensusEngine`, and `identity`/`referee` builders.
- **`src/lift/agent.ts`** — `LiftState` union extended with `pending`/`committed`/`timedout`
  (the commit-phase journal states the discovery ticket flagged as "next ticket's").
- **`docs/architecture.md`** — § Referee model now states the **per-edge `LiftId`** decision;
  § State mapping lists the landed `src/lift/` files and the port boundaries.

`yarn build` / `yarn lint` clean; `yarn test` green — **103 tests, 10 suites (+33 new)**. No
`.pre-existing-error.md` written; no pre-existing failures surfaced.

## Key design decisions the reviewer should sanity-check

1. **Per-edge `LiftId` (I own this seam — verify the reasoning).** Each route edge's finalize
   digest binds its own tally `Cid`, so the referee's signature differs per edge, and the
   `{ LiftId → refereeEdgeSignature }` payload map can only key them apart if `LiftId` is
   per-edge. So each strand's `PendingLift.LiftId` is a per-edge pledge id; the whole lift is
   correlated by the ChipNet `transactionCode` + the originator's `LiftJournal` row (keyed by
   the discovery `liftId`). This is fully schema-compatible (`PendingLift.LiftId` is the
   per-strand PK; `LiftFinalize` matches per-strand). The alternative — one shared `LiftId` —
   is **impossible**: it would collapse N distinct per-edge signatures onto one map key. Doc +
   a `NOTE:` at the top of `commit.ts` record this.
2. **The canonical digest layout is provisional-but-pinned.** There is no Quereus `Digest()`
   to match, so `digest.ts` establishes the contract and `digest.test.ts` pins it (byte-parity
   against an explicit schema-order field list, plus permuted-order rejection). When the runner
   registers `Digest()`, it MUST implement this layout or both change in lockstep. This is the
   single highest-risk assumption in the ticket.
3. **The ChipNet whole-record commit-digest preimage is a stand-in.** `getCommitDigest`
   (transactionCode + sessionCode + payload + topology + promises) is unbound; the referee
   signs an injected `RecordDigest`, and the harness feeds it `digest([transactionCode,
   sessionCode])`. This signature only drives ChipNet liveness/propagation — **not** settlement
   (the per-edge digests are the settlement proof) — so the placeholder does not affect schema
   correctness. Reconcile when ChipNet lands.

## Honest gaps (treat the tests as a floor)

- **No live Quereus runner, no live ChipNet.** `EdgeStrand` and `ConsensusEngine` are injected
  ports; the tests exercise them against `InMemoryTally`, which **emulates** the schema's lift
  gates (reserved-credit gate, single-finalize, finalize/void exclusion, referee-signature
  verify, balance chain). This is agent-layer behavioral parity, **not** proof against the real
  schema — the same caveat `feat-schema-lift-chits`'s review recorded. When a runner exists,
  re-run these flows (pledge → reserved-vs-settled → finalize → void → mutual-exclusion →
  credit gates) against real Quereus inserts. In particular, the *soft-under-concurrency*
  isolation question (two finalizers, or a finalize racing a void) is **not** modeled here — it
  rides the same open Optimystic-snapshot question flagged across the schema.
- **Transport wiring is a thin unbuilt adapter.** `LiftParticipant.ingest(record: LiftRecord)`
  is not directly assignable to the transport's `RecordParticipant(record: TrxRecord,
  fromPeerId)` (LiftRecord is a superset of TrxRecord — contravariant param). At the live-node
  wiring point you cast (`frame.body` already IS the LiftRecord; the transport already does
  `body as TrxRecord`). Deferred to the first ticket that stands up a live cadre node, exactly
  as `feat-chipnet-transport` deferred its live binding. `fromPeerId` is intentionally unused —
  the referee-signature check, not the transport gate, is the safety boundary.
- **Contradiction recovery is out of scope.** A single referee that signs commit for some edges
  and void for others is **detected and logged** (`applyResolution` tracks per-`LiftId`
  decisions; a contradiction is `skipped-contradiction` + a `CONTRADICTION` log line), but the
  compensating reversal is not built — deferred to `backlog/feat-multi-referee-consensus`. A
  `NOTE:` sits at the referee honesty assumption in `referee.ts`.
- **Timeout-void liveness.** A referee that never resolves leaves pledges reserved until a
  timeout void. The driver routes a timeout to the `timedout` journal state, but the bounded
  party-driven release is `backlog/feat-lift-timeout-release` (referenced, not built), and the
  coordination with the transport's push-wake-failure path is only modeled, not exercised
  against a live transport.

## Use cases for validation (what the tests assert, and what to re-check)

Map to the ticket's "Key tests" floor — all green:

- **Full-route commit settles every edge** · settled balance moves by the ceiled units in each
  edge's own denomination (both `F` +Units and `S` −Units), reserved→settled with no double
  count (`commit.test.ts` "full-route commit").
- **Full-route void releases every edge** · zero settled movement, reservation released
  ("full-route void").
- **Referee signature verifies against the schema constraint form (digest byte-parity)** ·
  explicit schema-order field digest equals `liftTermsDigest`; a permuted-order signature is
  rejected (`digest.test.ts`). The `InMemoryTally.finalize`/`void` re-verify the referee
  signature exactly as `LiftFinalize`/`RefereeVoidValid` would, so commit settlement exercises
  it end-to-end too.
- **Commit-cannot-replay-as-void** (and vice versa) · distinct digests; a commit signature
  fails `RefereeVoidValid` and a void signature fails `LiftFinalize` (`digest.test.ts`,
  `referee.test.ts`, `commit.test.ts`).
- **Second finalize rejected** · re-ingest is `skipped-idempotent` (no double delta); a direct
  double-finalize throws `single-finalize`; finalize-after-void throws `NotVoided`.
- **Two concurrent pledges on one edge respect the reserved credit gate** · the second pledge
  over the limit is rejected and does not land.
- **Not-fully-promised route pre-promise-voids without stranding a pledge** · the driver pledges
  then, on a void resolution, releases — reserved returns to baseline, journal `pending →
  aborted`.
- **Idempotent ingestion** · a re-delivered record (push-wake retry) applies exactly once.
- **Safety: verify before acting** · a tampered referee signature is `skipped-unverified` and
  the strand never settles.
- **Crash/restart rebuild** · `rebuildEdgePhase` reads `unpledged`/`pending`/`finalized` from
  the strand, not the journal.

Not yet covered (needs a live runner / live node): real Quereus constraint rejection,
concurrent-finalize isolation, a genuine ChipNet consensus round, and the transport-adapter
round trip.

## Tripwires parked (NOTE at site, not filed as tickets)

- **Digest byte layout must be reconciled with the runner's `Digest()`** — `NOTE:` at the top
  of `src/lift/digest.ts`. Pinned by `digest.test.ts` so a drift is caught.
- **Single-referee equivocation** — `NOTE:` at `SingleReferee` in `src/lift/referee.ts`, points
  at `backlog/feat-multi-referee-consensus`. Detection lands here; recovery does not.
- **ChipNet whole-record commit-digest preimage is a stand-in** — `NOTE:` at `RecordDigest` in
  `referee.ts` and at the harness's `resolve`.
- **Wire serialization** — the record encodes `units` as a decimal string (JSON has no bigint),
  matching the `terms.ts` bigint-serialization tripwire from discovery; the transport body
  boundary is where the real encode/decode shim lands.

## Empty categories

- **Major findings → new tickets:** none from implementing this half — the deferred work
  (multi-referee, timeout-release) was already filed in `backlog/` and is referenced, not
  re-created.
- **Pre-existing failures:** none surfaced; nothing written to `.pre-existing-error.md`.
