description: Add simulated people who trade with each other over time, so that balances and credit capacity build up and run out the way they would in a real economy, and measure how well lifts keep the network working under that load.
prereq: tallysim-consensus
files: packages/tallysim/, packages/tallysim/docs/design.md, ../../mc/mychips/doc/sim-agent.md
----

Network shape alone does not decide whether lifts succeed. Lifts need credit capacity in the right **direction**, and that comes from trading: an entity that buys more than it sells uses up its capacity in one direction, and lifts (especially circular ones, which clear debt around a loop) restore it. Without a trading model, simulation results describe random graphs, not economies.

Needs a brainstorm with the developer before planning: which agent behaviours matter (producers vs. consumers, regular payment patterns, entities that seek out new tallies when a lift fails, credit limits that grow with trust), and which questions it must answer. MyCHIPs' agent modeler (`../../mc/mychips/doc/sim-agent.md`, versions 1–3, and its "Objectives for User Agent Model") is the prior art.

Candidate metrics: lift success rate over time, fraction of trade demand met, credit stuck with no usable capacity, share of debt cleared by circular lifts, how these vary with network growth.

Plugs into the "step the economy" seam left in `tallysim-runner` (the tail of the tallysim network-model tier).
