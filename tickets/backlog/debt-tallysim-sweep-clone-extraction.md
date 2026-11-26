description: Two tallysim sweep runners carry near-identical copies of the same scenario-cloning and spec-validation helpers; extract them to one shared module so a future change can't silently update only one copy.
files: packages/tallysim/src/sim/sim-runner.ts, packages/tallysim/src/sim/consensus-runner.ts, packages/tallysim/src/sim/sim-runner.test.ts, packages/tallysim/src/sim/consensus-runner.test.ts
difficulty: medium
----

## The duplication

The discovery sweep runner (`sim/sim-runner.ts`) and the consensus sweep runner (`sim/consensus-runner.ts`)
each carry their own private copy of the sweep "plumbing" that clones a base scenario per cell and validates
the spec:

- `applyVary(base, assignment)` — **byte-identical** in both.
- `cloneSimScenario(scenario)` — identical except the consensus copy additionally clones the optional
  `consensus` / `consensusSeed` fields.
- `cloneConditions(conditions)` — **byte-identical** in both.
- `cloneCapacity(cap)` — **byte-identical** in both (the longest of the set — a four-arm switch over the
  capacity-distribution kinds).
- `validateSimSweep` / `validateConsensusSweep` — same shape; the consensus copy widens the allowed
  materialised-network vary prefixes from `workload.*` to also accept `conditions.*` and `consensus.*`.

That is roughly 90 lines duplicated. The hazard is the usual one: when `SimScenario` gains a field that needs
cloning (as `consensus` just did), or the capacity union gains a kind, a contributor who updates only one
`cloneSimScenario` leaves the other silently dropping that field per cell — a quiet determinism/correctness
bug, not a compile error.

## Why it was left duplicated (context, not an excuse)

The discovery sweep is pinned **byte-identical** by a determinism guard test, and these helpers are private to
`sim-runner.ts`. The runner-cli implementer copied rather than extracted precisely to avoid re-touching the
pinned discovery path during a feature add. Extraction re-touches that path, so it is its own change with its
own review, not an inline cleanup.

## The shape to aim for

Extract the shared helpers into one module (e.g. `sim/sweep-clone.ts`): `applyVary`, `cloneSimScenario`,
`cloneConditions`, `cloneCapacity`, and a validation helper parameterised by the allowed materialised-network
vary prefixes (`['workload.']` for discovery, `['workload.', 'conditions.', 'consensus.']` for consensus).
`cloneSimScenario` should clone the `consensus` / `consensusSeed` fields unconditionally — harmless for the
discovery runner (they are absent on a discovery scenario, so the clone is a no-op) and it removes the only
real divergence between the two copies.

Both runners then import from it. **The acceptance bar is that the discovery sweep stays byte-identical** — the
existing `sim-runner.test.ts` determinism / concurrent-vs-sequential guard sweep must still pass unchanged, and
the consensus runner's determinism + validation tests (`consensus-runner.test.ts`) likewise. No behaviour
change is intended; this is a pure DRY/maintainability refactor.
