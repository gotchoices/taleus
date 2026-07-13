----
description: Let a lift be arbitrated by several independent referees voting by majority, instead of a single one, so that no one referee can secretly break a lift among parties who don't fully trust it.
files: schema/draft1.qsql (PendingLift, Ledger LiftFinalize, LiftVoid), src/lift/referee.ts, docs/architecture.md (§ Referee model and the commit seam)
----

Taleus v1 ships **single-referee** lifts: each `PendingLift` names one `RefereeKey`, and one `RefereeSignature` settles each edge. That is fine when the referee is trusted (e.g. the payer's own agent refereeing the payer's payment), but it is a single point of both liveness and trust: a malicious single referee can sign *commit* to some edges and *void* to others, breaking all-or-nothing atomicity, with no other vote to overrule it (ChipNet's "lying referee" case). This is exactly the weak spot for lifts among **mutually-distrusting strangers** — the case where clearing is most valuable.

ChipNet already supports the fix: its commit phase is a **referee set** with majority consensus (`n ≥ ⌈total/2⌉`). What's missing is the Taleus schema and agent support to record and locally verify a *majority* rather than a single signature.

## What this needs (scope, not a plan)

- **Schema.** Generalize `PendingLift.RefereeKey` (single) → a referee **set + threshold**, and `Ledger.RefereeSignature` (single) → a **majority signature bundle** the `LiftFinalize` constraint verifies against the set/threshold locally (still no cross-strand transaction — every strand independently checks the same majority). `LiftVoid` likewise generalizes to a majority void.
- **Agent/referee.** `src/lift/referee.ts` runs multiple referee votes; the commit path collects a majority of per-edge signatures before an edge may settle.
- **Referee selection.** How a set of mutually-acceptable referees is negotiated during discovery (ChipNet's promise-phase referee acceptance already votes on this; extend from one to a set), including tie-break rules for even-sized sets (ChipNet has pre-agreed rules).
- **Network-split / dead-referee behavior.** Majority-across-islands resolution (ChipNet `doc/cluster.md` § Exceptions) becomes relevant once there is more than one referee — design the stuck-resource and re-convergence handling.

## Why backlog, not now

v1 single-referee is usable and consistent with the landed schema (`feat-schema-lift-chits`); this is an additive robustness/trust upgrade, not a correctness fix for the shipped path. Promote when stranger-to-stranger lifts (untrusted referees) become a target scenario. Related: `backlog/feat-lift-timeout-release` (stuck-reservation liveness under any referee count).
