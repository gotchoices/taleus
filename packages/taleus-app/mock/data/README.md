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

Every namespace has a `<namespace>.meta.json` recording its variants and the conventions particular
to it. Read that before editing a fixture.

Conventions worth keeping:

- **Amounts are whole numbers** of the unit's smallest part, with `denom` and `scale` alongside.
  `{ "units": 18000 }` on a scale-2 dollar tally is a hundred eighty dollars. No decimals anywhere —
  not in the data, and not on screen either (`design/specs/domain/amounts.md`).
- **A unit may say more than `scale`.** `divisor` gives a subdivision that is not a power of ten
  (sixty minutes to an hour); `code` and `mark` are how it is written. A `mark` containing a currency
  symbol is ignored by the app, so a fixture cannot make a unit look like dollars.
- **Collections a screen asks about by id are keyed by id** — `tally`, `entries` — because an adapter
  that ignores its argument returns the wrong record and looks right doing it.
- **Nothing derived is stored.** Ageing (`outstandingDays`, `waitingDays`) is computed by the adapter
  from a timestamp, so the same code runs when the engine supplies one.
- **No user-visible prose.** Fixtures carry `kind` and data; the sentence is written by `t()`. An
  engine will never hand the app English.
- **Perspective is explicit** — `owed-to-me`, `owed-by-me`, `level` — because a balance means the
  opposite thing to each party and no screen should have to work out the sign.
- **The cast is the stories'**: Jan reads the app; Sam, Mara, Dave, Rae, and Northwind Parts are his
  counterparties. Keeping one cast makes scenario screenshots legible as a set.
