# Mock data

Fixtures the app reads in mock mode, one namespace per file: `<namespace>.<variant>.json`.
Variant comes from the deep link (`taleus://screen/TallyList?variant=empty`); screens never see it —
the data layer does (`appeus/reference/mock-variants.md`).

Shapes follow `design/specs/domain/interfaces.md`, not the app's internal types. The engine does not
exist yet, so **these files are the working definition of what the app asks for** — the fodder for
`feat-engine-tally-api`. When the engine's real surface differs, the fixtures and the app's data
layer move together.

| Namespace | Serves | Variants |
|-----------|--------|----------|
| `party` | who I am, my display unit, my devices | happy |
| `tallies` | the tally list | happy, empty, error |
| `tally` | one tally: terms, agreement, counterparty | happy, error |
| `entries` | a tally's signed entries, with running balance | happy, empty |
| `requests` | outstanding and part-answered requests | happy, empty |
| `attention` | what is waiting on this party, across tallies | happy, empty |
| `position` | per-unit totals, the estimate, spending power | happy, empty |

Conventions worth keeping:

- **Amounts are whole numbers** of the unit's smallest part, with `denom` and `scale` alongside.
  `{ "units": 18000 }` on a scale-2 dollar tally is $180.00. No decimals anywhere.
- **Perspective is explicit** — `owed-to-me`, `owed-by-me`, `level` — because a balance means the
  opposite thing to each party and no screen should have to work out the sign.
- **The cast is the stories'**: Jan reads the app; Sam, Mara, Dave, Rae, and Northwind Parts are his
  counterparties. Keeping one cast makes scenario screenshots legible as a set.
