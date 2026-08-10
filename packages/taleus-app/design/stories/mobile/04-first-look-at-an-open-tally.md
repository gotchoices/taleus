# User Story: First look at an open tally

## Story Overview

As someone who has just opened their first tally
I want to see what I now have and what I can do with it
So that the relationship is usable rather than just agreed

Context: Continues [02](02-respond-to-an-invitation.md) or [03](03-negotiate-terms.md). Both parties
have signed the same terms. Nothing has been traded yet — the balance is zero.

## Roles

Both parties see the same tally, each from their own side. Where they differ is noted.

## Sequence

1. Each party is told the tally is open and with whom.
2. Each sees the tally listed with a zero balance in the unit they agreed on.
3. Each can see the terms in force: what they extended, what the other extended, and the notice
   periods — stated from their own point of view, so "what I allow" and "what they allow" are never
   ambiguous.
4. Each can see who the other party is, from what that party disclosed.
5. Each can see what they could do next: record something owed, ask the other party for something,
   or adjust their own limit.
6. **Sam**, who has nothing yet, sees a zero that is explained rather than bare — a tally with no
   history is normal, not an error.

### Alternative A: room to spend
2.1. A party whose counterparty extended them credit sees that they have room to spend, and how
     much, distinct from a balance they hold.

### Alternative B: more than one tally
2.1. A party with several tallies sees them together, each with its own unit and balance.
2.2. Where the units differ, an estimated total in their chosen display unit is offered, marked as
     an estimate, alongside the per-unit figures.

### Alternative C: I want out
5.1. Either party may ask to close the tally.
5.2. With a zero balance it closes. Otherwise it is marked as closing and stays visible until the
     balance settles.

## Acceptance Criteria

**Both parties**
- [ ] The tally appears with a zero balance in the agreed unit
- [ ] Terms in force are readable from each party's own perspective, both directions
- [ ] The counterparty's disclosed identity is visible
- [ ] An open tally with no history is presented as normal, with next actions offered
- [ ] Available room to spend is distinguishable from a balance held
- [ ] With mixed units, cross-unit totals are marked estimates and never replace per-unit figures
- [ ] Either party can request close at any time; with a zero balance it closes

## Variants
- happy: open tally, zero balance, next actions available
- empty: this is the party's only tally
- error: terms cannot be loaded; tally shown as unavailable rather than as zero
