description: Run simulations at a second, more realistic level, where each simulated entity runs the actual Taleus lift rules and its tallies live in a real database, to check that what the fast simulator shows still holds with the full stack in the loop.
prereq: feat-tallynet-bind-taleus-core, tallysim-consensus
files: packages/tallysim/, packages/taleus-core/src/lift/, packages/taleus-model/ (createLocalWorld, MemoryFabric), packages/tallysim/docs/design.md
----

`tallysim` runs the bare TallyNet protocol with simple default policies: fast, thousands of nodes. Once `feat-tallynet-bind-taleus-core` lands, `taleus-core` supplies the real policies: lift terms from trading variables, currency conversion with private quotes, the referee's per-edge digest, and schema verification of each lift on each tally strand.

A second simulation tier would run dozens of entities, each with taleus-core and its tallies on the in-process `MemoryFabric` (as `taleus-model`'s `createLocalWorld` does for two parties), emitting the same trace format so `tallysim-viewer` works unchanged. Purpose: confirm the fast tier's conclusions with the real lift rules in the loop, and catch disagreements between TallyNet's view of a lift and what the tally strands accept.

Plan it after binding: how much of the fast tier's scenario and trace machinery it reuses, the node count it can sustain, and which experiments are worth repeating at this tier.
