# Screen Spec: attention

---
id: attention
route: Attention
variants: [happy, empty, error]
---

## Description

Everything waiting on this party, across every tally, so nothing has to be hunted for (story 23).

## Behavior (user-observable)

- Each item says who it involves, what it is, what it would cost, and how long it has been waiting.
- Each item gets the party to the thing itself. A list that only names what is waiting is half a
  screen.
- Items waiting on this party are separated from items waiting on the counterparty. The second group
  is visible but never presented as a demand.
- Automated settling never appears here. It was authorized in advance and needs nothing.
- Empty: having nothing waiting is a good state and reads like one, not like a failure to load.
- Error: a list that cannot be read says so and offers to try again.

## Acceptance

- "I can tell whether anything needs me without opening each tally."
- "I can tell what is mine to act on from what is somebody else's."
- "I am not interrupted by value moving under settings I already signed."

## Notes

- Setting an item aside, deadlines, and the record of past items (story 23 paths E and F) are not in
  this slice.
