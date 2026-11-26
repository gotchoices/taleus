description: Replace the stand-ins Taleus's lift code uses in place of the lift protocol with the real TallyNet library, settle lifts by a majority of the voters the route's members nominated (not one referee), and rename ChipNet to TallyNet throughout the code and docs.
prereq: tallynet-voter-model, tallynet-propagation-timeouts
files: packages/taleus-core/src/lift/, packages/taleus-core/src/transport/, packages/taleus-core/schema/draft1.qsql (PendingLift, Ledger LiftFinalize, LiftVoid), packages/taleus-core/package.json, packages/taleus-core/README.md, packages/taleus-core/SPEC.md, packages/taleus-node/, packages/tallynet/docs/design.md, packages/tallynet/docs/STATUS.md, docs/architecture.md, docs/index.md, docs/STATUS.md, README.md, AGENTS.md
----

**Deliberately late.** Per `packages/tallynet/docs/STATUS.md`, TallyNet's protocol is iterated and measured in `tallynet`/`tallysim` first (regression check against ChipNet, voter model, record availability, timeouts, hostile actors), and `taleus-core` is bound **once**, against the settled protocol. Promote to `plan/` when that sequence reaches it.

## What exists

`taleus-core` already has the Taleus side of lifts (term building, conversion, route selection, pledge/settle, a libp2p transport), written against ChipNet's callback shapes with the protocol injected as **ports** (`DiscoveryEngine`, `ConsensusEngine`, a local copy of ChipNet's message types). Mapping: `packages/tallynet/docs/design.md` § The seam taleus-core already defines. It also carries a **legacy single-referee shape** from older MyCHIPs designs: `SingleReferee` (`src/lift/referee.ts`), `PendingLift.RefereeKey`, `Ledger.RefereeSignature`, and per-edge referee signatures riding TallyNet's commit `attachment`. That shape is replaced here, not preserved as a v1 policy.

## Scope

- **Engines.** `taleus-core` depends on `tallynet`. Real `DiscoveryEngine` / `ConsensusEngine` adapters; TallyNet's message types replace the local port (keep the wire envelope); one nonce function (TallyNet's). Thread TallyNet's `Clock` and `TraceSink` through (real clock by default; a sink the host may supply), so the later Taleus simulation tier (`feat-tallysim-taleus-tier`) can trace lifts.
- **Voter sets, from the start.** A lift settles on a strict majority of its voter set (the members who self-vote or were nominated in phase 1), per the voter model `tallynet-voter-model` settles. The schema verifies what that ticket specifies a tally needs: the voter set and threshold the record carries, and a majority's commit (or void) evidence covering this edge. Generalise `PendingLift` / `LiftFinalize` / `LiftVoid` accordingly; each strand still checks the evidence locally, with no cross-strand transaction. A pledge (the debtor's phase-1 promise) plus that evidence finalises the edge with no fresh debtor signature, so a member that refuses phase 2 cannot block its neighbour (it stays owing; it books its own side when it completes).
- **Taleus voter policy** through TallyNet's hooks: which voter sets a node accepts when promising, what it nominates (itself, or a well-known voter), and the route-choice cost of a plan's voter set.
- **Lift contract.** Whether a tally contract limits which lift contracts (CID in the proposal, per `tallynet-voter-model`) its tally honours, and the schema check for it.
- **Saved lift state.** Quereus-backed implementations of TallyNet's `ParticipantStore` / `TrxStore` (or record here which ticket owns them, e.g. `feat-taleus-node-service`), so lifts survive a restart.
- **End-to-end tests**: several `LiftAgent`/`LiftCommit` instances through real TallyNet over the in-memory transport (`src/transport/test-harness.ts`), single denomination, including a phase-2 refuser.
- **Rename sweep** `chipnet` → `tallynet`: protocol id `/taleus/chipnet/1.0.0` → `/tallynet/1.0.0` (other apps, e.g. a future MyCHIPs, implement it too), `ChipNetTransport*`, `CHIPNET_PROTOCOL`, file names, comments, `taleus-node` description, `README.md`, `AGENTS.md`, `docs/index.md`, `docs/architecture.md` § Lifts and ChipNet (retitle); close the `docs/STATUS.md` rename item. Upstream ChipNet stays named as the origin.
- **Correct architecture.md § Why reuse, not reboot** and § Referee model: state what TallyNet provides (voter sets, record availability, timeouts as built) instead of crediting ChipNet's unbuilt design-doc features; say "voters", not "the referee".
- Housekeeping: remove references to the deleted `chipnet-npm-publish-needed` (`src/lift/agent.ts`, `src/transport/chipnet-protocol.ts`, docs, `feat-taleus-node-service`); delete the stale NOTE above `view LiftLading` in `draft1.qsql` (scalar `max/2` binds now via `Greatest`/`Least`).

Multi-currency routing stays the next ticket (`feat-tallynet-multi-denomination`); here keep conversion at the originator (`accumulateRoute`) with TallyNet's default single-unit hooks.

## Edge cases & interactions

- All workspaces green; `taleus-core`'s existing lift/transport tests are the floor (adapt the single-referee ones to voter sets).
- App packages (`taleus-model`, `taleus-app`, `taleus-sereus`) build unchanged.
- Protocol id change needs no shim (no deployed nodes; no backwards compat yet).
- The per-edge Taleus digest stays byte-identical to the schema's `Digest()`; TallyNet's record digest is a separate preimage.
- Voter sets of 1, 2 (tie: no settlement), 3; a voter that equivocates; a voter set this node's policy refuses; a phase-2 refuser in the middle of a linear lift.

Likely splits in planning: engines + adapters; schema + voter policy; end-to-end tests; rename + docs.
