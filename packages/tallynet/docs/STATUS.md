# TallyNet status and sequence

Where TallyNet and its simulator stand, as a checklist in the order the work follows. Design lives in [design.md](design.md); the work itself lives in `tickets/` (slugs below, without sequence prefixes). Tick items as they land; this file records the **sequence** and why.

## Strategy: protocol first, bind once

TallyNet is developed, tested and measured on its own, with `tallysim` and `tallysim-viewer`, before `taleus-core` changes to use it. Reasons:

- The protocol is still moving (voter model, timeouts, hostile peers). Iterating inside one package is cheap; every change after binding also ripples into `taleus-core`'s adapters and schema.
- The voter model decides what each tally's schema must verify. Binding first would build in the legacy single-referee shape only to replace it.
- Simulation supplies the defaults (depth, time budget, voter policy, timeouts) from measurement.
- **Every node decides alone.** The library is per-node code (its own store, keys, clock, hooks and settings); no rule is global (design.md § Lift design principles, principle 0). The simulator must run independent nodes the same way: it may set up the world (give each node its tallies, trusted voters, settings) and watch it, but every transition at runtime is a node acting on what it holds.

`taleus-core` is bound once, against the settled protocol, with voter sets from the start. The cost of waiting: end-to-end lifts in the apps stay mocked until then. Treat "what a tally must verify" (design.md § Lift proposal and settlement) as the binding contract.

## Checklist

### 1. Protocol core
- [x] Shared pieces: crypto ports, session codes, nonces, canonical digest, step sequencing, rule engine; `Clock` and `TraceSink` ports; `tallynet/testing` (`tallynet-scaffold`, `tallynet-discovery-ports`)
- [x] Discovery: one round per level, depth = hops, hooks for currencies (`tallynet-discovery`)
- [x] Consensus: union merge, promise then vote, every signature verified, forged-vote side pool (`tallynet-consensus`, `debt-tallynet-forged-commit-shadows-vote`)
- [x] Regression check against ChipNet: no correctness regressions; push-echo fixed (`tallynet-chipnet-regression`, `bug-tallynet-push-echo-suppression`)
- [x] Voter model: terms (participant / voter / referee), consensus method and lift contract as proposal parameters, acceptance and plan-scoring hooks, the originator's plan→record minting, record pull, equivocation proof (`tallynet-terms-and-proposal-params`, `tallynet-lift-policy-hooks`, `tallynet-originator-proceed`, `tallynet-record-availability`)
- [x] Timeouts: deadline from the transaction code, voters void at the deadline, recovery loop (`tallynet-deadline-timeout-votes`, `tallynet-stalled-recovery`)
- [ ] Void when the promise set never completes: at the deadline a voter that hasn't committed votes void even without every promise, so a lift with a dead participant closes (`tallynet-void-incomplete-promises`)
- [ ] Per-node settings for the remaining hard-coded limits (pending-vote cap, proof cap, TTL ceiling) (in `tallysim-independent-nodes`)

### 2. Simulator (`tallysim`)
- [x] Seeded network generators, whole-graph oracle, sweep runner and CLI, route-existence experiment
- [x] Discovery on simulated time, traces, found-vs-oracle metrics and experiment
- [x] Consensus on simulated time: refusers, dropped links, commit-vs-found experiment
- [x] Voter-model scenarios (non-relayers, contact points, circular stand-in); timeout scenarios (slow voter, abandonment, split and rejoin)
- [ ] **Independent nodes**: persistent nodes; the originator picks the plan and mints the record itself; voters come from nominations made in discovery; each node has its own settings, random stream and policy, and books its own tallies from its own outcome; the manager only sets up, injects faults and observes (`tallysim-independent-nodes`; absorbs `debt-voter-nomination-on-path-composition`)
- [ ] Hostile actors: forgery and equivocation done (`tallysim-hostile-consensus-scenarios`); several voters and "no" votes, the experiment comparing consensus methods, viewer markers (`tallysim-multivoter-and-vote-no`, `tallysim-hostile-experiment-and-findings`, `tallysim-viewer-hostile-markers`)
- [ ] Trading model: balances that build up and drain over time (brainstorm first) (`feat-tallysim-trading-model`)
- [ ] Multiple currencies (`feat-tallysim-multi-denomination`)
- [ ] Real clearing discovery instead of the circular stand-in (`feat-tallysim-clearing-discovery`)

### 3. Viewer (`tallysim-viewer`)
- [x] Graph view, trace replay, live runs, sweep charts
- [x] Consensus animation, camera controls, voter-set and record-flow view
- [ ] UX pass: a spec (run with Fable), then implementation (`feat-tallysim-viewer-ux-spec`, `feat-tallysim-viewer-ux-implement`)
- [ ] Visual check by the developer, click-level (`debt-viewer-consensus-visual-qa`)
- [ ] Live-run settlement (`feat-viewer-live-consensus`); found-route paths in traces (`feat-trace-plan-found-path`)
- [ ] Large graphs: 3D view, fisheye lens (`feat-tallysim-viewer-3d`, `feat-tallysim-viewer-fisheye-lens`)

### 4. Policy (brainstorm with the developer)
- [ ] Reputation, evidence and expelling bad peers, fed by the hostile-actor results (`feat-tallynet-hostile-peers`)
- [ ] Healing inconsistent lifts (`feat-lift-healing`)

### 5. Binding to Taleus
- [ ] Bind `taleus-core`: voter sets from the start, the tally verification contract, lift contracts; rename ChipNet → TallyNet (`feat-tallynet-bind-taleus-core`)
- [ ] When a tally may release a held pledge (`feat-lift-timeout-release`)
- [ ] Real multi-currency lifts (`feat-tallynet-multi-denomination`)
- [ ] Taleus-level simulation tier: real lift rules on in-process strands (`feat-tallysim-taleus-tier`)

### Deferred until a step needs them
Protocol: `feat-tallynet-multi-path-lift`, `feat-tallynet-adaptive-budget`, `feat-tallynet-bidirectional-search`, `feat-tallynet-routing-hints`, `feat-tallynet-trust-query`, `feat-tallynet-lift-identity-options`, `feat-tallynet-identity-verification`, `feat-tallynet-discovery-caching`, `debt-tallynet-query-economics`.
Simulator: `feat-tallysim-false-capacity-advertising`, `feat-tallysim-hostile-query-flooding`, `debt-tallysim-native-double-sign-resource`.
Cleanups: `debt-tallynet-invalid-record-logging`, `debt-tallynet-macrotask-callback-drop`, `debt-tallynet-discovery-scale-intent-tests`, `debt-tallysim-sweep-clone-extraction`, `debt-tallysim-viewer-headless-webgl-smoke`.

## Regression check against ChipNet

Done (`tallynet-chipnet-regression`): no correctness regression; feature tables in [chipnet-review.md](chipnet-review.md) § Regression check.

## Research question

How complex must a tally network become before lift payments become statistically likely? Results so far are in `packages/tallysim/docs/design.md`: § First experiment (route existence), § Found vs. oracle (discovery), § Commit vs. found (consensus: 10% refusers already cost a third of commits). A fuller answer needs independent nodes, the trading model and the hostile-actor results.
