# Screen Spec: position

---
id: position
route: Position
variants: [happy, empty, error]
---

## Description

How the party is doing overall: what they are owed, what they owe, and what that leaves them worth
(story 40).

## Behavior (user-observable)

- Owed and owing are shown as **two quantities**, not only their difference.
- Figures are broken out per unit, because that is where they are exact.
- A single estimate in the party's chosen unit is available, marked as an estimate, and it **names
  what it leaves out** for want of a rate.
- The estimate uses the less favourable direction of a two-way rate.
- Credit available is never mixed into what the party holds. Spending power appears separately, in
  two parts: value others hold for them, and credit others extended them.
- Empty: a party with nothing yet is told what this will show rather than shown zeros.

## Acceptance

- "I can see what I am owed and what I owe without them being netted away."
- "I can tell an exact per-unit figure from an estimate."
- "I can see what the estimate could not account for."
- "I can tell what I could spend from what I am worth."

## Notes

- Position over time, concentration by counterparty, and unsettled movement (story 40 paths C, D, E)
  are not in this slice.
