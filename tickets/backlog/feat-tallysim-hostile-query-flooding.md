description: Simulate a node that spams the route-finding phase with floods of extra search messages, and measure the message-cost burden it imposes on everyone else — the groundwork for later deciding how to price or rate-limit queries.
files: packages/tallysim/src/sim/harness.ts, packages/tallysim/src/sim/protocol-metrics.ts, packages/tallynet/src/testing/network.ts
----

Parked out of `7-tallysim-hostile-actors`. The consensus-phase junk-signature flood (pushing garbage commits, capped by the side pool) **is** covered in the `7.x` chain (`tallysim-hostile-consensus-scenarios`). This ticket is the other flood: **discovery-phase query amplification**.

## The attack

A node that, on receiving a discovery sub-query, issues **many extra** sub-queries (fan-out amplification) or re-issues queries it has already answered — inflating the message count the rest of the network must absorb. The damage here is **cost, not correctness**: it does not change which routes are found, it makes finding them more expensive, and it is the concrete motivation for `debt-tallynet-query-economics` (pricing queries against flooding), referenced from `feat-tallynet-hostile-peers`.

## Why it is parked

Unlike the other hostile behaviours, this one has no existing seam: the discovery hooks shape *which* candidates a node forwards, not *how many extra* messages it originates. Making a node amplify needs either a new per-node discovery emission hook in the `tallynet` testing harness (`InMemoryNetwork`) or a sim-side driver that injects extra `discover`/`queryPeer` traffic — a bigger, more speculative change than the voter-level attacks, and lower value until query pricing is actually on the table. The measurement is already supported in spirit: `protocol-metrics.ts` counts `messages` per query, so a flood shows up as a message-cost distribution shift once the emission mechanism exists.

## Rough shape when picked up

- A `queryFloodFraction` dial + a per-node amplification factor.
- A discovery-emission seam (in `tallynet/testing` or sim-side) letting a selected node fan out extra sub-queries.
- A sweep reporting the message-cost burden (`messages`/`nodesTouched` distributions) vs flood fraction, feeding the query-economics discussion.
