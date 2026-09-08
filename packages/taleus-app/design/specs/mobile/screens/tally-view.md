# Screen Spec: tally-view

---
id: tally-view
route: TallyView
variants: [happy, error]
---

Stories 04 and 07 say what this screen is for. Only the correction is here.

## Overrides

- **Terms carry two effective dates, not one.** Story 07 step 3 reads as singular — "the date the
  terms took effect is visible" — and there are two, because the directions took effect on different
  days. Show both, each with its own direction.

## Notes

- The `error` variant is an unreachable counterparty; the tally still reads (story 04 path C).
- Two scenes worth reviewing are different tallies inside the happy fixture rather than variants: a
  new tally with a zero balance, and one in a unit that divides by sixty.
- Acting on terms, closing, and paying are separate screens, not yet sliced.
