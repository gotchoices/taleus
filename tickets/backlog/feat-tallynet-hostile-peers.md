description: Decide how Taleus notices and deals with peers that misbehave during lifts (stalling, dropping or delaying messages, flooding, sending junk, a referee voting both ways), using evidence, a local reputation for each neighbour, and ways to stop routing through or trading with offenders.
files: packages/tallynet/docs/design.md, packages/tallynet/src/discovery/, packages/tallynet/src/consensus/, packages/taleus-core/src/lift/, docs/architecture.md
----

## The class

TallyNet's protocol rules make sure no unauthenticated input can change a verified outcome (see `packages/tallynet/docs/design.md` § Protocol design). That handles forgery. It cannot stop **misbehaviour by a participant that is allowed to act**, because the protocol can't tell malice from failure:

- a route member refuses to promise, never forwards records, or goes silent mid-lift (a stall);
- a node drops, delays or replays queries or records;
- a node floods queries, records or junk signatures;
- a referee signs both commit and void (equivocation, which *is* provable, since both signatures verify);
- a node answers discovery with plans it won't honour, or with false terms.

Locally the protocol can only bound the damage (time budgets, `feat-tallynet-propagation-timeouts` to void stalled lifts, per-peer caps). Deterrence has to come from consequences, and those belong in **Taleus**, where each neighbour is a known counterparty authenticated by a shared tally.

## Questions to settle (needs a brainstorm with the developer)

- **Evidence:** what is provable and worth keeping (equivocating referee signatures; a promise followed by a stall past timeout?), how it is stored, and whether it may be shared with others or kept local only.
- **Attribution:** a forged message names nobody, and the neighbour that relayed it may be innocent. What can be attributed, and to whom.
- **Reputation:** a per-neighbour local score from lift outcomes (timeouts caused, junk relayed, query volume). Inputs, decay, and how it feeds the propagation policy (stop routing through a low-score neighbour).
- **Expulsion:** stop routing through a neighbour, mark a tally as unavailable for lifts, raise the price (fees), or close the tally. Which are automatic and which need the user.
- **Referee choice:** how evidence of a bad referee affects which referees a node accepts in future lifts.
- **Overlap:** `debt-tallynet-query-economics` (pricing queries against flooding), `feat-tallynet-propagation-timeouts`, `feat-tallynet-trust-query`, `feat-lift-timeout-release`.

Simulation can measure each policy: add hostile node types to tallysim (stallers, droppers, flooders, equivocating referees) and measure lift success and how fast the network routes around them.
