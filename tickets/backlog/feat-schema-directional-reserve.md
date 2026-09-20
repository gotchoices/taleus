description: Gate credit on the worst case a pledge could settle at, not on the net of opposite-direction pledges — today two lifts crossing in a tally can settle past a credit limit.
files: packages/taleus-core/schema/draft1.qsql, packages/taleus-core/test/STATUS.md
difficulty: medium
----
## Why this ticket exists

`ReservedBalance` is a single signed number: settled balance plus every open pledge's delta,
foil-issued positive and stock-issued negative. Both reserved gates — `Ledger.WithinReservedCredit`
and `PendingLift.WithinReservedCredit` — test that one number against both parties' limits.

Netting is the bug. Two open pledges running opposite ways through the same tally belong to two
different lifts, with two different referees, resolving independently. Netting them asserts they
will finalize together or void together, and nothing makes that true.

Demonstrated sequentially — no concurrency, no isolation question:

- Jan (stock) grants 50000. Settled balance 30000.
- Jan pledges 10000 out. Reserved 20000.
- Sam pledges 25000 in. Reserved 45000, inside the 50000 limit, so it is **admitted**.
- Sam's lift finalizes. A finalize is exempt from both credit gates by design (a referee-committed
  lift must always settle), so the settled balance becomes **55000**.
- Jan's lift voids. Reserved is now 55000 too.

Jan is owed 5000 more than the limit he granted, and every step was accepted by both replicas.

## What the gate should test

A credit limit is a bound on the worst case, so the projection has to be one-sided per direction.
The ceiling ignores outgoing pledges (they can only help, and may void); the floor ignores incoming
ones:

- ceiling = settled + sum of open **foil-issued** pledges ≤ stock's granted limit
- floor = settled − sum of open **stock-issued** pledges ≥ −foil's granted limit

One signed number cannot carry both, which is why this is a schema change and not a view rename.
`ReservedBalance` stays useful as the *expected* landing point — it is the honest thing to show a
person — but it must stop being what the gates read.

## Interactions

- `ClosingReducesReserved` reads the same netted number, so closing has the same hole: a pledge can
  look like it reduces the reserved balance while raising the ceiling.
- `LiftLading` advertises capacity from the reserved views. Advertising off the netted number
  over-advertises by the same amount.
- `feat-lift-timeout-release` is adjacent and compounding: an open pledge holds its reservation
  forever if the referee never resolves it, so a wrong reservation is also a permanent one.
- Nothing here is the deferred-CHECK isolation question (`debt-deferred-constraint-snapshots`).
  This fails with one writer, in order.

## Open questions

- Whether the two one-sided sums want their own views (`ProjectedCeiling` / `ProjectedFloor`) or
  should be inlined into the four gate sites. Views read better; the schema already notes that
  view-inside-CHECK is unexercised in any Quereus runner, and this would add four more uses.
- Whether a party should be able to see both bounds, or whether the expected value plus a "could
  reach" figure is the honest presentation.
