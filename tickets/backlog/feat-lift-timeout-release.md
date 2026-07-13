description: When the neutral third party overseeing a value-clearing lift goes silent forever, the credit each participant set aside for that lift is frozen with no way to reclaim it — design a safe way to release it.
prereq: feat-schema-lift-chits
files: packages/taleus/schema/draft1.qsql
----

## The problem

A **lift** clears value around a cycle of tally relationships. It is overseen by a single agreed **referee**
whose one signature — commit or void — resolves every participating tally the same way; that shared signature
is the *only* thing that makes the lift atomic ("all edges settle or none do") without any cross-tally
transaction.

`feat-schema-lift-chits` deliberately makes the referee the **sole** party that can resolve a pending lift.
That is what keeps atomicity safe: no individual participant can void their own edge while the referee-committed
others settle. The cost: if the referee becomes **permanently unreachable** (crashes, goes offline for good,
or is malicious and simply stalls), every participant's pending lift pledge stays open forever. An open pledge
**reserves credit capacity** — it counts against the participant's limits — so a dead referee silently freezes a
slice of each participant's tally until the credit limit is renegotiated or the tally is closed.

This matches how ChipNet already treats referee reliability (choose a dependable referee; run backups), so it
is not a correctness bug — it is a liveness limitation. But a stuck reservation with no escape hatch is poor UX
and, with a malicious referee, a capacity-denial vector.

## What's wanted

A **safe** way to release a pending lift's reserved capacity when the referee is gone, **without** breaking
atomicity. The hard constraint: the escape must not let one edge void while a genuine (possibly late) referee
commit settles the others. Candidate directions to weigh (design work, not yet decided):

- **Bilateral release.** Both parties of the tally co-sign a release after expiry. Safe because it needs the
  *counterparty's* agreement, but it only frees this one edge — the other edges on the route need their own
  releases, so the lift can still end up half-settled if a referee commit was in flight.
- **Bounded/expiry-anchored void with a global tie-break.** A rule that makes "referee commit" and
  "post-expiry release" provably mutually exclusive across all edges — hard without a shared clock or a
  cross-strand transaction, which is exactly what the design avoids.
- **Referee redundancy / fallback referee.** Push the problem back to ChipNet: a quorum or backup referee so
  "the referee is gone" effectively never happens.

Resolve which approach (or combination) actually preserves atomicity before writing any schema — a naive
unilateral or even bilateral void can silently break it.

## Not urgent

Nothing in the initial lift-chit schema is incorrect without this — a well-chosen, reachable referee never
triggers it. Promote when stuck-capacity from dead referees becomes a real operational concern, or alongside
the ChipNet referee-selection work.
