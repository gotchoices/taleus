description: Add misbehaving nodes to the network simulator (ones that stall, drop or delay messages, flood, forge, or vote both ways) and measure how much each kind hurts lifts and how well the protocol's defences hold, to ground later decisions about reputation and expelling bad peers.
prereq: tallynet-propagation-timeouts
files: packages/tallysim/, packages/tallysim/docs/design.md, packages/tallysim-viewer/, packages/tallynet/docs/design.md, tickets/backlog/feat-tallynet-hostile-peers.md
difficulty: medium
----

TallyNet's rules stop forgery from changing outcomes (no unverified input may block a verified one), majority voting stops a minority of voters from breaking a lift, and `tallynet-voter-model` / `tallynet-propagation-timeouts` make promised lifts completable and stalled ones end. Misbehaviour by members that are allowed to act can't be prevented locally, only bounded and, later, punished (`feat-tallynet-hostile-peers`, a brainstorm with the developer). This ticket measures it first.

## Scope

Hostile node behaviours as scenario options (a fraction of nodes, or chosen nodes), each a small policy plugged into the simulated node:
- refuses to promise; promises then refuses phase 2 (signing and/or relaying);
- drops, delays or replays queries and records;
- floods queries or junk signatures;
- forges signatures for others (should never change an outcome);
- a voter that equivocates (commit to one side, void to the other); a nominator that packs the voter set with puppets (up to whatever cap the voter model sets);
- answers discovery with plans it won't honour.

Metrics: lift success, completion of cooperating members, time to settle, credit left held, messages spent, and whether any lift settled inconsistently (must be zero unless a voter majority equivocates; then report it as the expected failure). The viewer marks hostile nodes and shows where lifts break.

Record findings briefly in `packages/tallysim/docs/design.md`, and feed concrete questions into `feat-tallynet-hostile-peers` (edit that backlog ticket).

## Edge cases & interactions

- Determinism under the seed holds with hostile nodes.
- A hostile node that is also a voter; several colluding.
- Defences already in place (forged-vote side pool and its cap) are exercised and shown to hold.
