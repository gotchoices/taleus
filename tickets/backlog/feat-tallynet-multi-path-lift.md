description: Let one payment be met by combining several routes at once when no single route has enough capacity, settling them together so either all go through or none do.
files: packages/tallynet/src/consensus/, packages/tallynet/src/discovery/, packages/tallynet/docs/design.md
----

Parked out of `tallynet-voter-model` (plan, 2026-11-25). v1 mints a lift record from a **single** discovery plan (design.md § Lift proposal and settlement, "One plan per record"): if no one plan has enough capacity to meet the amount, the originator keeps searching or the lift fails.

A multi-path lift would split one amount across **several disjoint routes** and settle them **atomically together** — all commit or all void — so a payment can use aggregate capacity across parallel routes it could not fit on any one. This is a large extension: it changes the originator's proceed step (choose and combine a *set* of plans summing to the amount), the record/topology shape (several disjoint paths under one transaction, or several linked records), and the settlement rule (one atomic outcome across the set). It touches the voter model (one voter majority over the combined set, or per-path majorities with a cross-path commit), record availability, and the tally verification contract.

**Tradeoff v1 accepts:** simpler atomicity (one topology, one majority) at the cost of no capacity aggregation across parallel routes.

Worth building if simulation (`tallysim-voter-model`, trading model) shows single-path capacity is a real limiter on settlement rates. Design the atomicity model first (one record with disjoint paths vs. a bundle of linked records); it interacts with `feat-tallynet-bidirectional-search`.
