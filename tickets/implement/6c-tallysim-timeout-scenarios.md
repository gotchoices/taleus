description: Prove and measure the new self-resolving lift behaviour in the network simulator — run lifts that stall, split the network, and silence overseers, and report how long credit stays tied up and how often a lift never resolves.
prereq: tallynet-stalled-recovery
files: packages/tallysim/src/sim/consensus-harness.ts, packages/tallysim/src/sim/consensus-runner.ts, packages/tallysim/src/sim/consensus-metrics.ts, packages/tallysim/src/sim/conditions.ts, packages/tallysim/docs/design.md
difficulty: medium
----

Third of the propagation-timeout work. `prereq`s `tallynet-stalled-recovery` (seq 6b); transitively depends on
`tallynet-deadline-timeout-votes` (6a). This ticket exercises the new protocol timeouts at scale and measures
them. It unblocks `7-tallysim-hostile-actors`.

The simulator already drives discovery + consensus on the virtual clock (`sim/consensus-harness.ts`,
`consensus-runner.ts`, `consensus-metrics.ts`) and compiles network conditions — latency, dropped links,
sleeping/late nodes (`sim/conditions.ts`). Today it works around the missing timeout loop by calling the pull
by hand (`recoverStrandedByPull`) and surfaces a stalled lift as `pending`. Once 6a/6b land, the protocol
self-resolves and self-recovers, so this ticket:

1. **Removes the manual `recoverStrandedByPull`** (or demotes it to a deliberate, documented fallback) and
   lets the virtual clock advance past the lift deadline so the protocol's own deadline + recovery timers
   fire. Confirm the end-to-end outcomes are unchanged where they should be (stranded-then-recovered members
   still settle) and improved where expected (a silent-voter lift now *voids by itself* instead of staying
   `pending`).
2. **Adds stalled and split scenarios** to the consensus harness/runner:
   - a multi-voter lift with one (or a minority) of voters made sleeping → voids by the deadline;
   - a dropped-commit-push lift → recovers by the loop;
   - a network **split** (partition the route's links via conditions) that isolates a cooperating member or
     splits the voter set, then optionally rejoins → assert `pending` while split, convergence after rejoin;
   - a permanently-stuck lift (needed party never returns) → stays `pending`, recovery abandons after the
     ceiling. Count these.
3. **Measures** what the plan asked for: **time-to-resolution** (virtual-clock ms from `start` to every node
   terminal — extend the existing time-to-settle distribution to include timeout-driven settlements) and
   **credit-held duration / how often credit stays held** (per lift: ms each participant's resource stayed
   held before release; and the count/fraction of lifts left permanently `pending` = credit never released).
   Add these to `ConsensusRunMetrics` alongside the existing `pCommitGivenFound` / `voidReasons`.

## Edge cases & interactions

- **Virtual clock must advance past the deadline.** The harness drives discovery + consensus to quiescence
  today; now it must also let time pass to `expiresAt + grace` and drain the timer-scheduled callbacks (the
  `Clock.setTimer` promises the virtual clock tracks). Ensure the run loop advances until all armed timers
  have fired or been cleared, not just until message quiescence — otherwise a timeout lift reads `pending`
  only because the clock never reached its deadline.
- **`ttlMs` sizing in the harness.** `buildLift`/`runLiftForOutcome` must set a `ttlMs` large enough that the
  happy path commits before the deadline but small enough that stalled scenarios reach it within the run
  budget. Make it a scenario parameter; document the default.
- **`voidReason` taxonomy.** A deadline-driven void is `voted-no-commit` (an `NC`), not `stalled`; `stalled`
  now means permanently `pending` after recovery abandoned. Re-check `analyzeLift`'s precedence so a lift that
  *did* resolve by timeout is counted as a void, not a stall.
- **Determinism across the added timers.** Conditions, network, workload and economy seeds stay independent;
  the new timers run on the same virtual clock and must not read the shared random (session-code minting). Two
  runs at one seed produce identical time-to-resolution and held-duration distributions.
- **Balance safety.** A timeout void must leave balances unchanged (only a commit moves them); a split that
  later commits moves them exactly once. Assert `net.deliveryErrors === []` on clean runs and conservation of
  balance across the route.
- **No regression of the pinned discovery sweep.** Only the lift record is sanitised/driven; the shared
  discovery adjacency stays byte-identical (the existing finite-ification caveat).

## TODO

- Advance the harness run loop past the lift deadline and drain timer callbacks; make `ttlMs` a scenario knob.
- Remove `recoverStrandedByPull` as the primary mechanism (keep as a documented fallback only if a test
  genuinely needs it); verify the protocol's own loop recovers the stranded-member scenarios.
- Add stalled / dropped-push / split(-rejoin) / permanently-stuck scenarios to the consensus harness + runner.
- Extend `consensus-metrics.ts`: time-to-resolution over timeout-settled lifts; per-lift credit-held duration
  and the permanently-`pending` count/fraction; fold into `ConsensusRunMetrics`. Adjust `analyzeLift` so a
  deadline void is `voted-no-commit` and `stalled` means abandoned-pending.
- Tests for each scenario + the new metrics; a seed-stability test over the added timers.
- Update `packages/tallysim/docs/design.md` § Consensus simulation to describe the timeout/recovery scenarios
  and the two new metrics.
- Run `yarn workspace tallysim build && yarn workspace tallysim lint && yarn workspace tallysim test 2>&1 | tee /tmp/tallysim-6c.log` (streamed).
