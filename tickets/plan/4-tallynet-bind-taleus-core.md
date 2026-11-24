description: Swap the temporary stand-ins that Taleus's lift code has been using in place of ChipNet for the real TallyNet library, and rename ChipNet to TallyNet throughout the code and docs.
prereq: tallynet-discovery, tallynet-consensus
files: packages/taleus-core/src/lift/, packages/taleus-core/src/transport/, packages/taleus-core/package.json, packages/taleus-core/README.md, packages/taleus-core/SPEC.md, packages/taleus-core/schema/draft1.qsql, packages/taleus-node/, docs/architecture.md, docs/index.md, docs/STATUS.md, README.md, AGENTS.md
difficulty: medium
----

`taleus-core` already has the Taleus side of lifts (term building, conversion, route selection, referee dual signature, pledge/settle, a libp2p transport), written against ChipNet's callback shapes with ChipNet itself injected as **ports** (`DiscoveryEngine`, `ConsensusEngine`, a local copy of ChipNet's message types) because ChipNet couldn't be installed. The full mapping is in `packages/tallynet/docs/design.md` § The seam taleus-core already defines. This ticket makes `taleus-core` depend on `tallynet` and provides the real engines.

Multi-denomination routing is the *next* ticket (`tallynet-multi-denomination`, waiting on a policy decision). Here, keep `taleus-core`'s current behaviour: conversion accumulated at the originator in `negotiatePlan` (`accumulateRoute`), with TallyNet's default single-unit hooks. Lifts within one denomination must work end to end when this lands.

## Scope

- `taleus-core` depends on `tallynet` (workspace). Replace the local message-type port in `src/transport/chipnet-protocol.ts` with TallyNet's types; keep the wire envelope. One nonce function (TallyNet's).
- Real `DiscoveryEngine` and `ConsensusEngine` adapters over TallyNet, plus in-memory TallyNet stores for tests. Keep the existing doubles where they test Taleus logic in isolation; add end-to-end tests that run several `LiftAgent`/`LiftCommit` instances through real TallyNet over the in-memory transport harness (`src/transport/test-harness.ts`).
- `SingleReferee` uses TallyNet's exported record digest (closing the "commit-digest preimage" gap noted in `src/lift/referee.ts`).
- **Rename sweep** `chipnet` → `tallynet`: protocol id `/taleus/chipnet/1.0.0` → `/tallynet/1.0.0` (TallyNet is a protocol other apps, e.g. a future MyCHIPs, implement too, so its id carries no Taleus prefix), `ChipNetTransport*`, `CHIPNET_PROTOCOL`, file names, comments, `taleus-node` package description, `README.md`, `AGENTS.md`, `docs/index.md` (Conventions note), `docs/architecture.md` § Lifts and ChipNet (retitle), and close the `docs/STATUS.md` rename item. Upstream ChipNet stays named as the origin.
- **Correct architecture.md § Why reuse, not reboot**: it credits ChipNet with ring/star voting, void-on-timeout, network-split and lying-referee handling and query economics, which exist only in ChipNet's design docs (see `packages/tallynet/docs/chipnet-review.md` § Designed but not implemented). State what TallyNet v1 actually provides and point to the backlog tickets.
- Remove remaining references to `chipnet-npm-publish-needed` (deleted; vendoring replaced it) in code comments (`src/lift/agent.ts`, `src/transport/chipnet-protocol.ts`), docs and `tickets/backlog/feat-taleus-node-service.md`.
- `schema/draft1.qsql`: delete the stale NOTE above `view LiftLading` claiming scalar `max/2` fails to bind (fixed with `Greatest`/`Least`).

## Edge cases & interactions

- `yarn test` across all workspaces stays green; the 104 existing lift/transport tests in `taleus-core` are the floor.
- The app packages (`taleus-model`, `taleus-app`, `taleus-sereus`) build unchanged. They don't import the lift modules today; confirm nothing exported by name changed under them.
- Protocol id change: no deployed nodes speak the old id yet; no compatibility shim needed (repo rule: no backwards compat yet).
- Digest parity: the per-edge Taleus digest (`src/lift/digest.ts`) must stay byte-identical to the schema's `Digest()`. TallyNet's record digest is a separate preimage; don't merge them.
