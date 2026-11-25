description: Make route finding smarter about how long it waits each round — instead of a fixed guess, learn from how fast earlier rounds answered and wait just long enough to catch most replies without stalling on the slowest few.
files: packages/tallynet/src/discovery/originator.ts, packages/tallynet/docs/design.md, packages/tallynet/docs/chipnet-review.md
----

When route discovery searches outward, the originator waits a time budget for each round's replies before moving one step deeper. v1 (ticket `tallynet-discovery`) uses a deliberately simple budget: a fixed starting amount plus a fixed increment per level. That is coarse — it can wait too long on shallow, fast networks and too little on deep, slow ones.

ChipNet's upstream design did better in principle: it kept a histogram of observed round-trip times (the `sparstogram` package) and projected a Pareto ("80/20") cutoff — wait for the bulk of replies, don't stall for the slow tail — growing the budget adaptively from what it measured. TallyNet dropped that in v1 because the upstream code was an untested prototype and, as written, it **trusted timing statistics reported by other nodes**, which a hostile or clock-skewed peer could lie about to distort the search.

This ticket is the adaptive version, done safely:

- Derive the per-round budget from a distribution of round-trip times the originator **measured itself on its own clock**, not from any figure a peer reports. Peer-reported `QueryStats` stay informational only.
- Replace the fixed linear growth with a projected cutoff (the histogram/Pareto idea, or a simpler quantile estimator — evaluate both; a plain running quantile may be enough and avoids a dependency).
- If a histogram library is used, confirm it is platform-neutral (pure ESM, no Node built-ins — `sparstogram` v1.1.0 is `type: module` and qualifies) or inline a minimal estimator.
- Measure the win in the simulator (`tallysim-discovery`): does adaptive budgeting find the same routes with fewer wasted round-trips or lower latency than the fixed rule? Only keep it if it demonstrably beats the simple rule.

Not urgent: the fixed rule is correct, just not optimal. This is a tuning enhancement, best informed by simulator metrics once those exist.
