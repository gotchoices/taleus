# Screen Spec: tally-list

---
id: tally-list
route: TallyList
variants: [happy, empty, error]
---

Stories 06 and 04 say what this screen is for and what it must do. Only the corrections are here —
the two places where what an agent would reasonably infer is wrong.

## Overrides

- **No total appears.** A column of balances invites a sum, and there is none to make: units are not
  combined, and the cross-unit estimate belongs to `Position`.
- **A tally that has not begun trading is not given a balance.** An offer has no balance and is not
  "settled". Lead with the state and suppress the figure.

## Notes

- Sorting, filtering, and search (story 06) are not in this slice.
