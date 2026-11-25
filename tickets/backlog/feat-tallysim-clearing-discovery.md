description: Extend the network simulator so it can also test the protocol's ability to find circular "clearing" loops a node can use to cancel debt with itself, not just straight payments from one party to another.
files: packages/tallysim/src/sim/, packages/tallysim/src/oracle.ts (clearingCycles), packages/tallynet/src/discovery/ (self-is-target / circular search)
----

The discovery-simulation tier (`tallysim-discovery-harness` → `-trace` → `-metrics`) measures the real `tallynet` protocol on **payment** queries only: a route from a payer to a distinct payee. The tallysim oracle, however, also answers **circular clearing** questions (`oracle.clearingCycles` / `selfPayment`): starting and ending at the same node, does a directed cycle with spare capacity exist that lets that node clear debt around a loop? The oracle runner already has a `clearing` workload for this; the protocol side does not.

This ticket would add the clearing case to the protocol simulation: run `tallynet` discovery with originator = payee (the self-is-target / circular lift that the discovery engine already supports) and measure *found vs. oracle* for clearing cycles — availability (does the protocol find a usable loop a node has), cycle length, messages, and the same cost metrics the payment tier reports.

Why deferred (not done in the discovery tier):
- The v1 protocol is unidirectional payment search; the circular case works but is a distinct query shape and a distinct oracle comparison (`clearingCycles`, not `routeExistence`), enough extra surface to be its own pass.
- The headline research question — *how connected must a network be before payments route* — is answered by the payment tier plus the oracle's own clearing experiment; protocol-level clearing discovery is a refinement, not a blocker for the viewer (`tallysim-viewer`) or consensus (`tallysim-consensus`).

When picked up, it reuses the discovery harness, trace format and metrics modules unchanged, adding a `clearing` branch to the sim runner and a clearing-oriented protocol-metrics summariser (availability, cycle-length distribution) paralleling the oracle's `summarizeClearingMetrics`.
