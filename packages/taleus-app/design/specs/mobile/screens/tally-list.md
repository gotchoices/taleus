# Screen Spec: tally-list

---
id: tally-list
route: TallyList
variants: [happy, empty, error]
---

## Description

Every tally the party holds, and the launch route once a party exists. A party should be able to
answer "where do I stand, and does anything want me?" without opening anything (stories 06, 04).

## Behavior (user-observable)

- Each tally shows who it is with, its balance, and the unit that balance is in. A figure never
  appears without its unit.
- The balance is stated from the reading party's side: what they are owed, what they owe, or settled.
  Neither party has to work out a sign.
- A tally waiting on this party is distinguishable from one waiting on the counterparty, and from one
  waiting on nobody. Only the first is a demand.
- A tally that is not simply open — offered, closing, expired — says so.
- Tallies in different units sit together without their figures being combined. No total appears here.
- Empty: a party with no tallies is told what a tally is and offered both ways to get one — invite
  someone, or accept an invitation. It is not an error and does not read like one.
- Error: a list that cannot be read says so plainly and offers to try again when trying again could
  help. Nothing is invented and no stale list is passed off as current.

## Acceptance

- "I can see every tally I hold, with who it is with and where the balance stands."
- "I can tell at a glance which tallies want something from me."
- "I can tell a tally in hours from a tally in dollars without doing arithmetic."
- "With no tallies at all, I am told what I need rather than shown an empty box."
- "When my tallies cannot be read, I am told, and I can try again."

## Notes

- Sorting, filtering, and search belong to story 06 and are not yet specified here; this slice
  establishes the list itself.
- Opening a tally leads to `TallyView`, which does not exist yet.
