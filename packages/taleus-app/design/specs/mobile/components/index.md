# Components Plan

Shared building blocks. What each one *does* is recorded in
[`design/generated/mobile/foundation.md`](../../generated/mobile/foundation.md), where the
implementation mapping belongs. This file is the registry, plus the few rules a component must honour
that an agent would not infer.

| Component | Used by | Status |
|-----------|---------|--------|
| Amount | every screen showing a figure | built |
| Chit mark | Amount, wherever CHIP appears | built |
| Chip | TallyList, TallyView, TallyHistory, Attention | built |
| Card / Row / Openable row / Action | TallyView, Position, TallyList, Attention | built |
| Loading / Failed / Empty | every data-backed screen | built |
| Error boundary | the whole app | built |

## Rules

- **One implementation per concern.** A figure is drawn by `Amount` and nowhere else; the load state
  machine lives in one hook. Three screens colouring figures by three rules is how the first pass
  ended up with colour as the only cue for direction.
- **`Failed` offers to retry only when the data layer said retrying could help.** It is not a
  decoration on every error.
