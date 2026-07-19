description: A lift that resolves inconsistently (one partition commits while another voids, or a Byzantine referee half-commits) leaves some edges settled and others not — design an after-the-fact compensating "fixup" transaction that rebalances so honest parties are made whole.
prereq: feat-schema-lift-chits
files: packages/taleus/schema/draft1.qsql, docs/architecture.md
difficulty: hard
----
> **Speculative — not ready to implement.** This needs substantial design thought before any
> implementation is attempted: the atomicity, trust, and economic (insurance) models are all
> unresolved, and it depends on the tallyNet referee/consensus layer. Recorded to preserve the concept
> and its MyCHIPs lineage, **not** as a buildable spec. Do not promote to active work without a
> dedicated design pass first.

## The problem

A lift is atomic only because every edge verifies the **same** referee signature (commit or void).
Two failure modes break that assumption:

1. **Never resolved.** The referee goes permanently silent; every edge's pledge stays open forever.
   This is *stuck capacity* and is covered by `feat-lift-timeout-release` — not this ticket.
2. **Resolved inconsistently (this ticket).** Through a network partition/split-brain or a Byzantine
   referee that signs *commit* to some edges and *void* to others, the lift settles on some edges and
   cancels on others. Now a real imbalance exists: a party paid on one edge is not credited on the
   compensating edge. Value was actually lost by an honest party.

Note the common, benign case is *not* this: a party that agrees to phase 1 but refuses to sign phase 2
simply causes a normal `void` — everyone's pledges release and the **refuser is the only one who
didn't get paid**, so a refuser harms only itself. The dangerous case is (2), where the outcome is
genuinely inconsistent across edges.

This is primarily the domain of the lift/route coordinator (ChipNet — likely to be rebranded
**tallyNet**), not the two-party tally schema. Recorded here because the *repair* leaves a trail of
chits on tallies, so the schema must be able to express it.

## The idea: a compensating "fixup" lift (recovered MyCHIPs design)

The original author designed exactly this in MyCHIPs but never implemented it. Source, so the concept
is not lost again:

- `mychips/doc/old-safety.md:76-83` (2021): a Transaction Manager ("TM") that holds a tally with each
  lift party can, for a fee (lift *insurance*), **"formulate a fixup lift, after-the-fact, to cure any
  inconsistency at no real cost to anyone (just making sure all the credits and debits cancel out)."**
  Objectives at `old-safety.md:101-107`: "All parties to a lift reach consensus about the commit/cancel.
  If that fails, insured transactions are at least repaired."
- `mychips/test/analysis/byzantine/` (2025, also design-only): elaborated as the **Insurance Chit /
  Resolution Chit** protocol (`scenarios/minority-recovery-3.md:7-11`) and **Partition Healing**
  (`scenarios/circuit-starvation.md:352-457`): insurance chits locally neutralize a stuck promise so a
  node can keep trading; when the majority reconnects, resolution chits through the insurer's tallies
  (e.g. `G→I→D`) rebalance the margin so "all parties made whole".

MyCHIPs' *implemented* behavior is only timeout → `void` (`schema/lifts.wms:52,61,136-144`), which
cancels pending chits rather than repairing an imbalance.

## Why the contract makes this tractable

Unlike blockchain among strangers, an opened tally is governed by a **contract with good-faith duties**
and **transitive terms** along the lift route. So a broken lift *can* be cured by an additional,
mutually-recognized transaction, and the loss should land on the bad actor more than the innocent
bystanders. The design goal: turn "inconsistent lift" from an unrecoverable loss into a bounded,
attributable repair.

## What's wanted (design, not yet decided)

- How a fixup transaction is expressed in the Taleus schema: is it an ordinary `Ledger` chit set, a new
  lift keyed to the original `LiftId`, or a distinct healing row? Who signs it (the insurer/referee that
  holds tallies with the affected parties), and how does an honest party verify it actually restores its
  own balance?
- How healing composes with `PendingLift` / `Ledger` (`Kind='lift'`) / `LiftVoid` and the reserved-credit
  gates — a repair must not itself be blockable by the same closing/credit gates that would strand it.
- The economic/trust model: who insures, who pays, and how insurance is discovered/agreed during route
  formation (this is the tallyNet layer).
- Interaction with `feat-multi-referee-consensus` (majority voting reduces how often (2) happens) and
  `feat-lift-timeout-release` (which handles (1)).

## Not near-term

Lift Byzantine-recovery is explicitly a later concern (the two-party direct-action path is the current
focus). Promote alongside the tallyNet referee/consensus work. No runner exists yet; capture the design.
