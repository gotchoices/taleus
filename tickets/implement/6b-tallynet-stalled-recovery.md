description: Make a stalled lift keep trying to reach everyone — a node that is stuck waiting periodically re-contacts its peers and asks them for the outcome, so a decision reached in one corner of the network eventually reaches every cooperating member and the held credit releases.
prereq: tallynet-deadline-timeout-votes
files: packages/tallynet/src/consensus/participant.ts, packages/tallynet/src/consensus/engine.ts, packages/tallynet/src/consensus/participant.test.ts, packages/tallynet/src/testing/consensus.test.ts, packages/tallynet/src/trace.ts, packages/tallynet/docs/design.md
difficulty: medium
----

Second of the propagation-timeout work (split from `tallynet-propagation-timeouts`). `prereq`s
`tallynet-deadline-timeout-votes` (seq 6a), which introduces the per-transaction timer registry this ticket
extends from a one-shot deadline timer into a periodic recovery loop. The simulator ticket
`tallysim-timeout-scenarios` (seq 6c) `prereq`s this.

6a makes a stalled lift *decide* at its deadline (un-voted voters vote `NC`). But a decision only helps a node
that **receives** it. Two gaps remain:

1. A node stuck in `promising`/`propagating` whose only link-neighbour went silent (a dropped push, a node
   that slept, an interior refuser) never hears the decision reached elsewhere, and so holds its credit
   `pending` indefinitely.
2. A voter that voted `NC` at the deadline but whose push was dropped never delivers that `NC`, so the
   majority never forms for the nodes that needed it.

The record-availability prereq (`tallynet-record-availability`, complete) built the **pull** (`fetchOutcome`
+ `serveRecord`) and the **push** exactly for this, but nothing *triggers* them after a lift goes quiet —
`fetchOutcome`'s own doc says "the timer-driven recovery loop ... is `tallynet-propagation-timeouts` (a seam,
not built here)". Today the **simulator** triggers the pull by hand (`tallysim` `recoverStrandedByPull`). This
ticket moves that into the protocol as a timer-driven loop, so a real deployment self-heals and the simulator
can stop doing it manually.

Read first: `src/consensus/participant.ts` (`fetchOutcome`, `serveRecord`, `push`, `reachablePeers`, and 6a's
timer registry + `onDeadline`); `docs/design.md` § Record availability; ChipNet `../chipnet/doc/cluster.md`
§ Commit Phase (bounce / route-around / "try next node in ring" — the recovery intent) and § Exceptions
(Network splits — "any single cross-island link restores the trend toward resolution").

## The mechanism

**Extend 6a's registry into a periodic recovery loop.** While a node holds a **non-terminal** record (outcome
`pending`) it re-arms a recovery timer after each tick. On fire, `onRecoveryTick(transactionCode)`:
- reload the stored record; if released / terminal / not-a-member, clear the timer and stop;
- **re-push** the current record to reachable peers. The push skip-test suppresses an unchanged re-push to a
  peer that already acked it, which is wrong for recovery (the ack may have been to a *stale* copy, or the
  peer restarted). Clear this transaction's peer-record cache (or add a `force` path to `push`) so recovery
  genuinely re-sends. Keep it bounded — re-push only to the links/contact points in `reachablePeers`.
- **pull** via `fetchOutcome(transactionCode)` — ask each reachable peer for its merged copy and union it in
  (idempotent; injects no unverified state). This is the stranded-member rescue.
- run the advance loop + the deadline action (if the deadline has since passed, `onDeadline`'s logic applies —
  share the path so a node that was asleep through its deadline both votes *and* recovers in one tick);
- if still non-terminal, re-arm with **exponential backoff** (ChipNet's "time doubling ... to avoid
  thrashing"): start at `RECOVERY_BASE_MS`, double each quiet tick up to `RECOVERY_MAX_MS`. Reset the backoff
  to base whenever a tick changed our state (merged a new signature / advanced), since progress means the
  network is live again.

**Give-up ceiling (bounded, not infinite).** A lift whose needed party is permanently gone must not re-push
forever. After the record has been expired for longer than `RECOVERY_GIVEUP_MS` past `expiresAt`, stop
re-arming and leave the record `pending` (resources stay held — this is the genuinely-stuck case decision 7 in
6a; the out-of-band release is `feat-lift-timeout-release`, the schema half, not this package). Emit a
`recovery-abandoned` trace so the simulator can count permanently-stuck lifts. A later inbound delivery
(connectivity returns) still re-arms via `update`, so abandonment is not final — it only stops *our* active
polling.

**Trace.** Add `recovery-tick` (`transactionCode`, `attempt`, whether it changed state) and
`recovery-abandoned` (`transactionCode`). `record-pushed`/`record-received`/`settled` already cover the rest.

## Edge cases & interactions

- **Backoff resets on progress.** A tick that merges a new signature or advances state resets the delay to
  `RECOVERY_BASE_MS`; a tick that changes nothing doubles it. Assert a converging lift settles quickly (base
  delay) while a truly stuck one backs off toward `RECOVERY_MAX_MS` instead of hammering.
- **Pull of a never-seen record is impossible.** `fetchOutcome` with no stored record returns `pending` and
  pulls nothing (no topology ⇒ no addresses) — a node that never received the record cannot self-recover and
  is not this loop's concern (its neighbour re-pushes to it instead). Keep that `fetchOutcome` guard; test
  that recovery on an unknown transaction is a clean no-op.
- **Idempotent re-push / re-pull.** Union merge + the release-once flag make every repeat harmless: a settled
  node re-pushing its terminal record just informs a lagging peer; a pull reply that is stale or duplicate is
  a no-op. Assert no double-release across many recovery ticks.
- **Network split then rejoin.** Two islands, neither holding a voter majority, both stay `pending` and both
  keep polling at backoff. When a single cross-island link is restored (a delivery arrives), the merge carries
  the far island's votes, a majority forms, and both converge and release. Drive this end-to-end (the sim has
  split conditions; a `participant.test` double can simulate one restored link).
- **Re-push vs the skip-test.** The normal `push` skip-test must stay (it prevents push storms in the happy
  path); only the *recovery* path forces a re-send. Keep the two push modes distinct so a happy-path lift does
  not lose the skip optimisation. Test that an unchanged happy-path push is still skipped.
- **Timer lifecycle under settlement racing a tick.** A delivery that settles the lift between a tick firing
  and its re-arm must clear the timer; a tick firing just after `releaseOnce` must see the release flag and
  stop. Share the terminal check at the top of every tick.
- **Give-up then reconnect.** After `recovery-abandoned`, an inbound `update` (connectivity returned) must
  re-arm the loop (reset backoff to base). Assert abandonment is recoverable.
- **Many concurrent transactions.** The registry is keyed per `transactionCode`; a node on several lifts arms
  one loop each, independently backed-off. No cross-talk. (The per-node `update`-serialisation caveat from
  `engine.ts` still applies — a host serialises `update` per transaction; recovery ticks go through the same
  path and inherit it.)
- **Determinism / no leaked timers.** All timing through the injected `Clock`; `no-node-globals.test` green;
  every arm has a matching clear on terminal/abandon. Same seed + virtual clock ⇒ identical recovery schedule.

## TODO

- Add `RECOVERY_BASE_MS`, `RECOVERY_MAX_MS`, `RECOVERY_GIVEUP_MS` exported constants.
- Extend 6a's registry: track per-transaction backoff state; add `onRecoveryTick` (reload → terminal-check →
  force re-push → `fetchOutcome` → advance/deadline → re-arm with backoff or abandon).
- Add a forced-re-push path (clear the peer-record cache for this transaction, or a `push(record, {force})`
  mode) used only by recovery; leave the happy-path skip-test intact.
- Fold the deadline action into the recovery tick (a node asleep through its deadline votes + recovers in one
  tick); keep 6a's one-shot `onDeadline` or subsume it — pick the cleaner composition and document it.
- Add `recovery-tick` / `recovery-abandoned` trace events; emit them.
- Re-arm the loop on an inbound `update` after abandonment (reset backoff).
- Update `fetchOutcome`'s doc note (the "seam, not built here" line) to point at the built loop.
- Unit tests: backoff doubles on a quiet tick and resets on progress; give-up after the ceiling emits
  `recovery-abandoned` and stops; a post-abandon `update` re-arms; recovery on an unknown/terminal transaction
  is a no-op; forced re-push re-sends while the happy-path skip-test still skips.
- End-to-end tests: an interior-refuser lift where a cut-off member recovers by the loop alone (no manual
  pull); a dropped-commit-push lift that self-heals; a split-then-rejoin lift that converges after one restored
  link. These should pass **without** the simulator's manual `recoverStrandedByPull` (6c removes it).
- Update `docs/design.md` § Record availability / § Protocol design to describe the recovery loop, backoff,
  and the give-up ceiling (and that abandonment is not final).
- Run `yarn workspace tallynet build && yarn workspace tallynet lint && yarn workspace tallynet test 2>&1 | tee /tmp/tallynet-6b.log` (streamed).
