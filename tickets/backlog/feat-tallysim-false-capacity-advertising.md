description: Simulate a node that lies during route-finding — claiming it can carry more payment than it really can — so payments get routed through it and then fail, and measure how much that kind of lie pollutes the network.
files: packages/tallysim/src/sim/harness.ts, packages/tallysim/src/sim/terms.ts, packages/tallysim/src/sim/sim-runner.ts, packages/tallysim/src/sim/protocol-metrics.ts
----

Parked out of `7-tallysim-hostile-actors` because it is invasive to a load-bearing invariant and lower-priority than the voter-level attacks that ship in the `7.x` chain.

## The attack

A node that, during discovery, **advertises or forwards a candidate it cannot honour** — it claims capacity (`capFwd`) its real tally does not have. Today the simulator's discovery hooks (`makeCapacityHooks` in `sim/terms.ts`) forward a candidate only when `capFwd ≥ amount`, drawn from the real tally terms, so a route is found only if the oracle agrees — the **`found ⊆ oracle`** guarantee, guarded by `falseFoundCount === 0` in `protocol-metrics.ts`. A capacity-liar deliberately breaks that: it makes discovery return a plan the whole-graph oracle rejects.

Note: the simpler reading of "answers discovery with plans it won't honour" — a node that is found on a route and *then refuses to promise* — is **already** modelled and measured as the existing `refuserFraction` dial (it keeps `found ⊆ oracle` intact; the plan was honest at discovery, the node just refuses later). This ticket is the harder, distinct case: a lie **at discovery time** about capacity.

## Why it is parked, not in the 7.x chain

Injecting a capacity-liar means a found route the oracle rejects, which **trips the `falseFoundCount === 0` guardrail** — currently a hard correctness invariant that proves the harness/terms wiring is honest. To add this attack without blinding that guardrail, the found-not-oracle signal must be **split into two lanes**:
- `falseFoundCount` — found-not-oracle **not** attributable to an injected liar on the path → still must be 0 (a real harness bug);
- a new `dishonestFoundCount` — found-not-oracle **attributable** to a known liar on the plan's path → the thing this attack measures.

That attribution (the sim knows the injected liar set and the plan's reconstructed path, so it can tell which lane a false-found belongs to) plus the guardrail split is a real, careful change to the discovery-measurement tier. At consensus such a lie collapses to a void anyway (the liar refuses, or `settleRoute`'s balance assert would fire), so the interesting measurement is purely **discovery pollution**: how many routes a population of liars causes the protocol to "find" that cannot actually carry value.

## Rough shape when picked up

- A `capacityLiarFraction` dial (own seed draw) selecting entities that override `negotiateIntent`/`planSatisfies` to forward despite `capFwd < amount`.
- `protocol-metrics.ts`: split `falseFoundCount` vs `dishonestFoundCount` by liar-on-path attribution; keep the honest guardrail at 0.
- A sweep + a line in the hostile-actor findings quantifying discovery pollution vs liar fraction.
