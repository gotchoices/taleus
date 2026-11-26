description: Make a lift that stalls end cleanly by itself instead of leaving everyone's reserved credit tied up: before everyone has promised, by voiding; after everyone has promised, by making sure the voters reach a decision and the result reaches every cooperating member.
prereq: tallynet-record-availability
files: packages/tallynet/src/consensus/, packages/tallynet/docs/design.md, packages/tallynet/docs/chipnet-review.md, packages/tallynet/docs/STATUS.md, packages/tallysim/, tickets/backlog/feat-lift-timeout-release.md, ../chipnet/doc/cluster.md
difficulty: hard
----

ChipNet's design (`../chipnet/doc/cluster.md` § Promise Phase, § Commit Phase, § Exceptions) includes mechanisms its code never implemented:
- **pre-promise void (PPV)**: a participant that times out waiting for promises signs a void instead of a promise;
- **void-on-timeout** by voters;
- **ring/star propagation** with a convergence node;
- **stalled-transaction recovery** (periodic re-reach);
- handling of dead voters, lying voters and network splits.

TallyNet today pushes the record to reachable members until settled, by a strict majority of its voter set, with no timer. the voter model (`tallynet-terms-and-proposal-params` … `tallynet-record-availability`) adds proposal parameters, voter-set acceptance, proceed/abort, contact points and record availability. This ticket adds time.

## Principle that bounds it

Before every participant has promised, a stalled lift may be voided (PPV, voters voting void at the proposal's deadline). **After every participant has promised, no participant may void on its own**: the lift completes once a voter majority decides, and each cooperating member must be able to obtain that outcome (design.md § Lift design principles, principle 3). So post-promise timeouts drive *voters* to decide and *records* to spread (re-reach, fetch from voters), never a participant-side void. A tie or a dead voter majority is the hard case: define it.

## Scope to plan

- **The deadline is a proposal parameter** (design.md § Lift design principles, principle 0). Today it is implicit in the self-expiring transaction code (`expiresAt(transactionCode)`); make it explicit in the proposal so each node can judge, before promising, whether enough time remains to execute, and refuse if not. A proposal that stalls and resurfaces past its deadline **before everyone has promised** is ignored and so dies out with no message needed. **After everyone has promised** the deadline can't simply be ignored: it is when voters vote void if they haven't committed, and a late-arriving record with a valid deciding majority must still be honoured. Define whether phases get their own deadlines, who acts at each, and how deadlines relate to the transaction code's expiry and to clock skew.
- PPV and voter void-on-timeout; the injection point (`participant.ts` `advanceState`, `propagating` branch).
- Stalled-transaction recovery: periodic re-push / fetch around the circuit until settled.
- Whether ring/star convergence is needed given the circuit, or the circuit plus fetch-from-voters suffices. Decide and record.
- Network splits and dead voters: what a member can and can't conclude; what stays pending.
- **Schema half.** `feat-lift-timeout-release` (Taleus: when a tally may release a pending pledge) is the other half. Don't change `taleus-core` here; write the rules it must follow into that backlog ticket (no edge may void while a genuine voter-majority commit settles others).
- Simulation: stalled and split scenarios in `tallysim`; measure time to resolution and how often credit stays held.
