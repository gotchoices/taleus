----
description: One of the schema's capacity views uses a two-argument min/max the query engine doesn't actually have, so that view won't load.
files: packages/taleus/schema/draft1.qsql
----

# LiftLading uses scalar 2-arg min()/max() — unsupported by Quereus

The `LiftLading` view in `packages/taleus/schema/draft1.qsql` computes advertised lift capacity with
**scalar** two-argument `max(...)` / `min(...)`:

```sql
max(0, min(RV.Target, min(RV.Bound, CCL.CreditLimit)) - PB.Balance) as FreeUnits,
max(0, min(RV.Bound, CCL.CreditLimit) - max(PB.Balance, RV.Target)) as RewardedUnits,
```

Quereus provides **aggregate** `min`/`max` only — no scalar 2-arg form (SQLite-style
`max(a, b)`). Loading the schema into Quereus fails to bind this view with:

```
Function not found: max/2
```

This is **pre-existing** — the expressions are present at `caab134~1` (the pre-lift-chit
base), untouched by `feat-schema-lift-chits`; that ticket only repointed the view's join from
`PerspectiveBalance` to `ReservedPerspectiveBalance`. It was surfaced during the lift-chit
review's machine-validation pass (the whole schema now *parses* after the constraint-trigger
syntax triage, and every other table/view — including all lift tables and the
`OpenPendingLift` / `ReservedBalance` / `ReservedPerspectiveBalance` reservation views — binds
cleanly; `LiftLading` is the sole binding failure).

## What needs deciding / doing

Two viable fixes — this is partly a Quereus-dialect question:

- **Rewrite in the schema** — express the clamps with `case` (e.g.
  `case when x < 0 then 0 else x end` for the outer `max(0, …)`, nested `case` for the
  pairwise `min`/`max`). Behavior-preserving, no engine change. Straightforward but verbose.
- **Add scalar `min`/`max` to Quereus** — SQLite has scalar variadic `min`/`max` alongside the
  aggregates; adding them upstream fixes this view and any future schema that reaches for the
  SQLite idiom. Cross-repo (`../quereus`).

Prefer the schema-side `case` rewrite unless there is appetite to close the SQLite-compat gap in
Quereus; capture whichever is chosen. Behavior must stay identical: `FreeUnits` = receiver
accumulation up to `min(Target, Bound, CreditLimit)` above the current reserved balance, floored
at 0; `RewardedUnits` = further accumulation up to `min(Bound, CreditLimit)` above `max(Balance,
Target)`, floored at 0.

## Notes

- Dormant for now: the schema cannot be exercised with data at all until the missing core tables
  land (`backlog/debt-schema-core-tables`, `backlog/debt-schema-tallycore-table`), so nothing
  reads `LiftLading` yet. This is schema-correctness debt, not a live bug.
- A signpost `NOTE:` comment sits at the `LiftLading` definition in `packages/taleus/schema/draft1.qsql`.
