description: Make a lift that stalls end cleanly by itself instead of leaving everyone's reserved credit tied up: before everyone has promised, by voiding; after everyone has promised, by making sure the voters reach a decision and the result reaches every cooperating member.
prereq: tallynet-voter-model
files: packages/tallynet/src/consensus/, packages/tallynet/docs/design.md, packages/tallynet/docs/chipnet-review.md, packages/tallynet/docs/STATUS.md, packages/tallysim/, tickets/backlog/feat-lift-timeout-release.md, ../chipnet/doc/cluster.md
difficulty: hard
----

ChipNet's design (`../chipnet/doc/cluster.md` § Promise Phase, § Commit Phase, § Exceptions) includes mechanisms its code never implemented:
- **pre-promise void (PPV)**: a participant that times out waiting for promises signs a void instead of a promise;
- **void-on-timeout** by voters;
- **ring/star propagation** with a convergence node;
- **stalled-transaction recovery** (periodic re-reach);
- handling of dead voters, lying voters and network splits.

TallyNet today pushes the record to reachable members until settled, by a strict majority of its voter set, with no timer. `tallynet-voter-model` adds voter-set rules, the circuit (closing contact, completion code) and record availability. This ticket adds time.

## Principle that bounds it

Before every participant has promised, a stalled lift may be voided (PPV, voters voting void at the deadline carried by the self-expiring transaction code). **After every participant has promised, no participant may void on its own**: the lift completes once a voter majority decides, and each cooperating member must be able to obtain that outcome (`tallynet-voter-model` principle 3). So post-promise timeouts drive *voters* to decide and *records* to spread (re-reach, fetch from voters), never a participant-side void. A tie or a dead voter majority is the hard case: define it.

## Scope to plan

- Deadlines: what each phase's deadline is, who acts at it, and how it relates to `expiresAt(transactionCode)`.
- PPV and voter void-on-timeout; the injection point (`participant.ts` `advanceState`, `propagating` branch).
- Stalled-transaction recovery: periodic re-push / fetch around the circuit until settled.
- Whether ring/star convergence is needed given the circuit, or the circuit plus fetch-from-voters suffices. Decide and record.
- Network splits and dead voters: what a member can and can't conclude; what stays pending.
- **Schema half.** `feat-lift-timeout-release` (Taleus: when a tally may release a pending pledge) is the other half. Don't change `taleus-core` here; write the rules it must follow into that backlog ticket (no edge may void while a genuine voter-majority commit settles others).
- Simulation: stalled and split scenarios in `tallysim`; measure time to resolution and how often credit stays held.
