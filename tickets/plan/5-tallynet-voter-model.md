description: Design how each lift's voters are chosen and limited, and make sure every cooperating member can finish a lift once everyone has promised, even if some member refuses or goes silent, by closing every lift (straight or circular) into a loop the final signatures can travel around.
prereq: tallynet-chipnet-regression
files: packages/tallynet/src/consensus/, packages/tallynet/src/discovery/, packages/tallynet/src/testing/, packages/tallynet/docs/design.md, packages/tallynet/docs/STATUS.md, packages/tallysim/, packages/tallysim/docs/design.md, packages/taleus-core/schema/draft1.qsql (read only: PendingLift, LiftFinalize), ../chipnet/doc/cluster.md
difficulty: hard
----

Design principles (from the original MyCHIPs and ChipNet designs; settled with the developer 2026-11-25). Record them in `packages/tallynet/docs/design.md` and build toward them:

1. **Voters, not a referee.** A lift is settled by a strict majority of its **voter set**. In phase 1 each participant may vote itself and/or nominate one or more outside voters; the set is their union. There is no single referee. (TallyNet's code calls voters "referees", member type `R`; settle whether to rename to "voter" throughout, recommended.)
2. **Validating evidence can come from anywhere.** Whichever node first holds a majority of commit votes holds the proof and propagates it; nothing routes through the originator.
3. **Promised means completable.** Once every participant has promised, every cooperating member must be able to obtain the voters' majority and complete, even if some member refuses to sign or relay in phase 2. A refuser only hurts itself: it stays owing its neighbour (that edge finalises from its phase-1 promise plus the commit evidence; Taleus's schema already works this way, `PendingLift` + `LiftFinalize`), and books its own income only when it completes.
4. **Linear and circular lifts are one circuit protocol.** A linear lift is a circular one minus the final chit back to the initiator. When the lift reaches the payee, the payee contacts the originator for a **completion code**; that contact closes the circuit (messages only: no tally, no terms, no chit) so phase-2 signatures can cycle in both directions. Members that publish contact points (ChipNet's `physical`) add further paths; voters are natural places to fetch a settled record.

## Design points to settle

- **Nomination rules and caps.** Puppet voters are the safety risk: all-or-nothing settlement breaks only if a **majority equivocates** (commit shown to one end, void to the other), so no single party may control a majority. Options: a cap per nominator (e.g. one outside voter), weighting by nominator, or each participant refusing sets it can't trust. Pick and justify.
- **Voter-set vetting at promise time.** Each participant's `shouldPromise` sees the full voter set and decides whether to trust its majority. Define what the hook receives.
- **Route-choice cost.** A hook the originator (and hosts) use to score plans by voter set: count (delay, more chances to stall), trust (self-voting, well-known, obscure), overlap (shared voters are free). A node that nominates heavily or obscurely becomes costlier to route through.
- **The closing contact.** How the payee reaches the originator (an address or channel supplied by the host, e.g. from Taleus's payment request, so neither publishes to the whole route); what the completion code is and proves (the originator really means to pay this payee this amount; ties to the transaction code); how the record then flows both ways around the circuit.
- **Record availability.** Push both directions around the circuit; contact points; fetching the settled record from voters by transaction code. Guarantee: with any single non-cooperating member, every cooperating member still obtains the outcome. State what holds with k > 1.
- **What a tally needs to verify.** Today a referee signs a separate per-edge digest for each edge, riding the commit `attachment` (`design.md` § Referee model). With voter sets that becomes voters × edges signatures. Evaluate the alternative: voters sign the record once, and each tally verifies (a) a majority of the record's voter set signed commit and (b) the record contains this edge with these terms. Recommend one, and write the exact verification a tally performs; it is the contract `feat-tallynet-bind-taleus-core` implements in the schema.
- **Equivocation evidence.** A voter that signs both commit and void leaves verifiable proof; keep it (input to `feat-tallynet-hostile-peers`).

## Simulation

Extend `tallysim` with: voter nomination policies, phase-2 refusers / non-relayers, with and without contact points, linear and circular lifts. Measure: completion rate of cooperating members vs number of refusers, time to settle, messages per lift, share of plans rejected for voter-set reasons. Show the circuit and the record's flow in the viewer.

## Edge cases & interactions

- Voter sets of 1, 2 (tie: no settlement), 3, many; a participant that is also a voter; the same voter nominated by several members (counted once).
- A refuser that is also a voter; a refuser adjacent to the payee (on the closing side); the payee itself refusing after the completion-code exchange.
- The originator unreachable after promises (closing contact gone): what completes and from where.
- Interplay with the forged-vote side pool (`design.md` § Protocol design): nothing unverified may block a verified vote.
- Timeouts are the next ticket (`tallynet-propagation-timeouts`); leave the seams.

Split into implement tickets (e.g. voter model + vetting + cost hook; circuit closing + completion code; record availability; tally verification contract; simulation + viewer).
