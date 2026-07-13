----
description: Build the commit half of a lift — pledge the agreed amount on every tally in the route, then have the agreed arbiter (the "referee") sign one all-or-nothing decision that finalizes every pledge or cancels them all.
prereq: feat-lift-agent-discovery
files: src/lift/referee.ts (new), src/lift/commit.ts (new), schema/draft1.qsql (PendingLift, Ledger LiftFinalize, LiftVoid), schema/portfolio.qsql (LiftJournal), docs/architecture.md (§ Referee model and the commit seam, § State mapping)
difficulty: hard
----

The commit half of the lift agent. Takes the selected `Plan` from `feat-lift-agent-discovery` and runs ChipNet's promise → commit → consensus flow, writing the pledge/finalize/void rows the schema (`feat-schema-lift-chits`) already enforces. This is where the **signature seam** in `docs/architecture.md` § *Referee model and the commit seam* is implemented — read it first; it is the crux of this ticket.

## What to build

- **Pledge (`src/lift/commit.ts`).** For each edge in the route, write a `PendingLift` row: `LiftId`, chosen `RefereeKey`, the edge's `Issuer/Units/Date/Expiry` (ceiled units in that edge's own denomination), issuer-signed over `Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry)`. Reserves capacity; does not move settled balance.
- **ChipNet transaction wiring.** Back ChipNet's `TrxParticipantState` with the tally strands (`PendingLift`/`Ledger`/`LiftVoid`) + `LiftJournal`, and provide `TrxParticipantResource` (`shouldPromise` / `shouldCommit` / `release`). Promise = the participant accepts the fully-formed record; commit = the referee votes.
- **Referee role (`src/lift/referee.ts`).** A single referee (v1 — set size 1). At commit it emits **both** signatures the docs require:
  1. ChipNet's whole-record commit signature (drives ChipNet liveness/propagation/void-on-timeout);
  2. one **per-edge Taleus signature** for each edge, over that edge's `Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry)` — carried in the record `payload` as `{ LiftId → refereeEdgeSignature }`.
- **Settlement.** On ChipNet consensus, each agent copies its edge's per-edge referee signature into a finalize `Ledger` row (`Kind='lift'`, the schema's `LiftFinalize` verifies it locally). On void/timeout, the referee signs `LiftVoid` over the distinct `Digest(Cid, LiftId, 'void')`; each agent writes it, releasing the reservation.

## Edge cases & interactions

- **Digest byte-parity (the make-or-break).** The per-edge digest the referee signs must be byte-identical to what the Quereus schema `Digest()` recomputes and verify under `SignatureValid()` — same field order (`Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry`), same sha256, same ed25519 (the shared `src/crypto/` from scaffolding). A mismatch means every finalize silently fails to settle. Add a test that a referee signature produced here verifies against the schema's constraint form.
- **Commit/void mutual exclusion & replay.** Commit and void digests are distinct by construction; assert a commit signature cannot satisfy `LiftVoid` and vice versa, and that a second finalize/void for a `LiftId` is rejected (schema does this — test it end-to-end).
- **Atomicity across strands with no cross-strand txn.** Every edge verifies the *same* referee decision independently. Test the whole route settles, or the whole route voids — never split.
- **Single-referee equivocation (documented v1 risk).** A malicious referee could sign commit for some edges and void for others, breaking atomicity (ChipNet "lying referee"). v1 accepts this; do **not** silently pretend it is prevented. Where the code assumes an honest single referee, mark it with a `NOTE:` pointing at `backlog/feat-multi-referee-consensus`. Detect-and-log a contradictory referee record (commit+void seen for one `LiftId`); recovery (compensating reversal) is out of scope.
- **Referee unreachable / timeout.** If the referee never signs, pledges stay reserved until timeout-void. Coordinate the void path with push-wake failure from `feat-chipnet-transport`. The bounded party-driven release is `backlog/feat-lift-timeout-release` — reference it, don't build it.
- **Participant contract carried from `feat-chipnet-transport` (review of that ticket).** The transport's `RecordParticipant` you register here must **verify the referee signature on every inbound `TrxRecord` before acting on it** — do not trust a record from the transport gate alone. The transport membership-gates a record only when its nonce maps to a known edge; a record relayed over a `C`-intent hop arrives with a nonce the receiver cannot map and is dispatched **ungated** (the transport can only correlate by `sessionCode`/`transactionCode`, never trusting the frame's own `Address`). The real safety boundary is this per-edge referee-signature check, not the transport.
- **Idempotent record ingestion.** The transport's `updatePeer` push-wake retry fires on *any* push failure (including an application-level ack rejection), so the participant may see the **same record delivered twice**. Ingestion must be idempotent — correlate by `transactionCode` and no-op a record already applied, never double-apply.
- **Credit-gate exemption on finalize.** A `Kind='lift'` finalize is exempt from both credit gates (schema decision 3) — a committed lift must always settle even past the nominal limit. Do not re-gate it in the agent.
- **Partial promise / pre-promise void.** If not all participants promise before timeout, the record must carry a pre-promise void, not a partial commit (ChipNet PPV). Ensure the agent never pledges-then-strands on a route that fails to fully promise.
- **Reserved-balance interaction.** The pledge must gate against `WithinReservedCredit` at insert (schema enforces); concurrent lifts on the same edge cannot collectively over-commit — test two concurrent pledges on one edge respect the reserved gate.
- **Crash/restart mid-commit.** The authoritative per-edge state is in the strand (`PendingLift`/`Ledger`), not `LiftJournal`; on restart the agent rebuilds in-flight state from the strands, not from the (reconstructible, non-authoritative) journal.

## Key tests

Full-route commit settles every edge · full-route void releases every edge · referee signature verifies against the schema constraint (digest byte-parity) · commit-cannot-replay-as-void · second finalize rejected · two concurrent pledges on one edge respect the reserved credit gate · not-fully-promised route pre-promise-voids without stranding a pledge. Expected: settled balance moves by the ceiled units in each edge's own denomination on commit; zero movement on void.

## TODO

- Implement `src/lift/commit.ts`: pledge writer, `TrxParticipantState`/`TrxParticipantResource` backed by strands + `LiftJournal`, finalize/void settlement.
- Implement `src/lift/referee.ts`: single-referee dual-signature (ChipNet record commit + per-edge Taleus digest), void signing.
- Add the digest byte-parity test against the schema's `Digest`/`SignatureValid` form; `NOTE:` the single-referee honesty assumption at its site.
- Tests per the floor above; `yarn test` green (stream with `tee`).
