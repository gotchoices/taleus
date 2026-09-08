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
- Each direction of the terms carries its own effective date; they took effect on different days.
- Room to spend appears as its own figure and is described as credit the other party extended — never
  as value held.
- The governing agreement is named, with who published it and in what language.
- What the counterparty disclosed is shown as their claim. Absent information is not presented as
  evidence of anything.
- Outstanding requests appear with which way each runs — asked of this party or asked by them —
  and marked as not part of the balance either way.
- A tally that is not simply open — offered, closing, amending, expired — says so.
- A tally with no history is presented as normal — a zero that is explained, not an empty result.
- An unreachable counterparty does **not** make the tally unreadable: it is this party's record too.
  The tally and its terms still read, and anything needing the other party is described as pending
  rather than failed (story 04 path C).

## Acceptance

- "I can tell what I owe or am owed without working out a sign."
- "I can see what I let them owe and what they let me owe, and not confuse the two."
- "I can tell credit available to me from value I hold."
- "I can see what agreement governs this, and who published it."
- "I can tell what they are asking for from what has actually been recorded, and which of us asked."
- "When the other party is unreachable, I can still read my own record."

## Notes

- Acting on terms (`ReviewOffer`), closing, and paying are separate screens, not yet sliced.
- Two scenes worth reviewing are not data variants but different tallies inside the happy fixture:
  a **new** tally (zero balance, explained) and one in a **unit that divides by sixty**. The `error`
  variant is the unreachable counterparty.
