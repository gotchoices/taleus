description: Make a lift that stalls partway through sign-on, or whose referee goes quiet, end cleanly by itself instead of leaving everyone's reserved credit tied up.
prereq: tallynet-consensus
files: packages/tallynet/, packages/tallynet/docs/chipnet-review.md, tickets/backlog/feat-lift-timeout-release.md, docs/architecture.md
----

ChipNet's design (`../chipnet/doc/cluster.md` § Promise Phase, § Commit Phase, § Exceptions) includes mechanisms its code never implemented:
- **pre-promise void (PPV)**: a participant that times out waiting for promises signs a void instead of a promise;
- **void-on-timeout** by referees;
- **ring/star propagation** with a convergence node;
- **stalled-transaction recovery** (periodic re-reach);
- handling of dead referees, lying referees and network splits.

TallyNet v1 (`tallynet-consensus`) pushes the record to reachable members until settled, with a single referee.

This overlaps `feat-lift-timeout-release` (releasing a pending pledge's reserved credit when the referee never answers), which is the schema-side half of the same problem. Plan them together: TallyNet decides *when* a lift is dead and propagates a void; the schema decides *whether* a given tally may release. The atomicity constraint in that ticket (no edge may void while a genuine referee commit settles others) governs both.
