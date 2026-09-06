# Screen Spec: tally-view

---
id: tally-view
route: TallyView
variants: [happy, error]
---

## Description

One tally, read from this party's side: where the balance stands, what each of them agreed to, who
the other party is, and what is being asked (stories 04, 07).

## Behavior (user-observable)

- The balance leads, in the tally's own unit, described from the reader's side — what they are owed,
  what they owe, or settled.
- Terms are shown **in both directions**, each labelled by who extended it. "What I allow" and "what
  they allow" are never ambiguous.
- The date the terms took effect is visible.
- Room to spend appears as its own figure and is described as credit the other party extended — never
  as value held.
- The governing agreement is named, with who published it and in what language.
- What the counterparty disclosed is shown as their claim. Absent information is not presented as
  evidence of anything.
- Outstanding requests appear as what the other party is asking, marked as not part of the balance.
- A tally that is not simply open — offered, closing, amending, expired — says so.
- Error: a tally that cannot be read says so and offers to try again; no stale figures are shown.

## Acceptance

- "I can tell what I owe or am owed without working out a sign."
- "I can see what I let them owe and what they let me owe, and not confuse the two."
- "I can tell credit available to me from value I hold."
- "I can see what agreement governs this, and who published it."
- "I can tell what they are asking for from what has actually been recorded."

## Notes

- Acting on terms (`ReviewOffer`), closing, and paying are separate screens, not yet sliced.
