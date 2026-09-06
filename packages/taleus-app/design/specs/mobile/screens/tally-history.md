# Screen Spec: tally-history

---
id: tally-history
route: TallyHistory
variants: [happy, empty, error]
---

## Description

What has actually happened on a tally, and what is still being asked (story 24).

## Behavior (user-observable)

- Entries are listed most recent first: amount, direction, date, and what it was for.
- Each entry shows the balance that resulted, so the current figure can be followed back rather than
  trusted.
- Each entry says who made it. Nothing in the history is anonymous.
- Entries that arrived because a payment routed through the tally are distinguishable from ones the
  two parties made deliberately.
- Outstanding requests appear **alongside** the entries, never among them, showing what has been
  applied and how long they have been outstanding — with a plain statement that only signed entries
  move the balance.
- Empty: a tally with no entries and nothing asked reads as normal, not as an error.

## Acceptance

- "I can follow how we got to today's balance."
- "I can tell what I did from what happened while I was asleep."
- "I can see what is still being asked of me without mistaking it for what I owe."

## Notes

- Narrowing by period, size, amount, or purpose (story 24 path B) is not in this slice.
