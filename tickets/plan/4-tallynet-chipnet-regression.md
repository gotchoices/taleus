description: Check, feature by feature, that the rewritten lift protocol (TallyNet) does everything the original ChipNet code and design did, or says why not, so nothing important was lost when we chose to rewrite instead of adopting ChipNet.
prereq: tallynet-discovery, tallynet-consensus
files: packages/tallynet/src/, packages/tallynet/docs/design.md, packages/tallynet/docs/chipnet-review.md, packages/tallynet/docs/STATUS.md, ../chipnet/src/, ../chipnet/doc/, ../chipnet/test/
difficulty: medium
----

TallyNet was rewritten from ChipNet (`../chipnet`, pinned at `29fbc24`) rather than adopted, because ChipNet's code had defects (`packages/tallynet/docs/chipnet-review.md`). The rewrite fixed those, but nobody has checked systematically that it kept everything ChipNet got right. This ticket is that check. It is analysis first: read both code bases and ChipNet's docs (`doc/discovery.md`, `doc/cluster.md`, and the rest), and produce a table plus tickets for real regressions.

## Must confirm explicitly

- **Validating signatures come from a proper majority of the voters proposed in phase 1**: not the originator, not one referee. Each participant may vote itself and/or nominate outside voters (`dependsOn`, member type `R`); the voter set is their union. Check how ChipNet builds the set and computes the majority, and that TallyNet does the same (TallyNet uses a strict majority both ways and rejects an empty set, by design; see `design.md` § Protocol design).
- **Evidence propagates from wherever the majority is first assembled.** Any node that holds a majority of commit votes can show the outcome and pushes it on; nothing routes through the originator. Check the reachable-peer rules (members with a published address, plus link neighbours) against ChipNet's.
- **A participant that refuses phase 2 cannot block cooperating members.** After all promises, completion depends only on the voters' majority; confirm both code bases behave so, and note where record availability around a non-cooperating member is missing (input to `tallynet-voter-model`).
- **Linear vs circular lifts.** In the original MyCHIPs design they are one circuit protocol: when the lift reaches the payee, the payee contacts the originator at an address carried in the proposal, and the originator starts the promise phase. Record what ChipNet does here (it returns the plan to the originator along the route) and what TallyNet does (today: a linear lift is open at both ends).

## Also compare

- Discovery: round structure and depth semantics (confirm `tallynet-discovery-depth-reach`'s conclusion, one round per level, against ChipNet), result stats and sleeping-node handling, how plans are assembled on the way back (`prependMatch`), what each hook sees, cycle and duplicate handling.
- Consensus: record shape, merge rules, what is signed, state machine, release semantics, logs.
- Intentional drops (e.g. the Sparstogram time budget, now `feat-tallynet-adaptive-budget`): each needs a stated reason.
- Designed in ChipNet's docs but never built (ring/star voting, convergence node, pre-promise void, void-on-timeout, stalled-transaction recovery, network splits, lying referees, query economics, bidirectional search): for each, which TallyNet ticket picks it up, or a decision not to.
- ChipNet's tests (`../chipnet/test/`): any scenario they cover that TallyNet's don't.

## Output

- A feature table (ChipNet code / ChipNet docs / TallyNet / status: kept, improved, deliberately dropped with reason, regression, not built anywhere) added to `packages/tallynet/docs/chipnet-review.md` as a new section, and summarised in `packages/tallynet/docs/STATUS.md`.
- A `fix/` ticket per real regression; a `backlog/` ticket for any unticketed designed-but-unbuilt feature; design questions for the voter model recorded in `tallynet-voter-model` (edit that plan ticket directly).
- No code changes in this ticket beyond tests that demonstrate a suspected regression.
