# User Story: First look at an open tally

## Story Overview

We have agreed. I want to see what I now have, understand what it lets each of us do, and know what
to do next — before anything has actually happened on it.

Context: Continues [02](02-respond-to-an-invitation.md) or [03](03-negotiate-terms.md). Jan and Sam
have signed the same terms: Jan will be owed up to $500, Sam extends nothing yet, three weeks'
notice, counted in dollars. Nothing has been traded. The balance is zero.

## Roles

Both parties see the same tally, each from their own side. Where their views differ, it is noted.

## Sequence

1. Each of them is told the tally is open, and with whom.
2. Each sees it with a zero balance, in dollars.
3. Sam, who has never had a tally, sees a zero that is explained rather than bare — a new tally with
   no history is what success looks like at this point, not an error or an empty result.
4. Each can see the terms in force from their own side: Jan sees that he is the one extending $500
   and that Sam extends nothing; Sam sees the same relationship described the other way around.
   Neither has to work out which number belongs to whom.
5. Each can see who the other party is, from what that party chose to disclose. Jan sees Sam's name
   and phone number; he can tell that Sam gave no address rather than that Sam has none.
6. Sam can see he has room to spend — $500 of Jan's trust — and that this is not the same thing as
   having $500.
7. Each can see what to do next: record something owed, ask the other for something, or change their
   own limit.
8. Sam buys the bike. The balance stops being zero, and both see it. → future story

### Alternative Path A: Jan's fuller picture
2.1. Jan has eleven other tallies. This one joins them, each with its own unit and its own balance.
2.2. Two of his tallies are in hours, not dollars. He can still ask what he is worth overall, in
     dollars, and gets an estimate — marked as an estimate, at his own rates, never replacing the
     real per-unit figures.

### Alternative Path B: Sam wants out
7.1. Sam decides this was a mistake before anything happens on the tally.
7.2. He asks to close it. The balance is zero, so it closes. Jan does not have to agree.
7.3. Had something been owed, the tally would stay visible as closing until it settled, and neither
     of them could add to it in the meantime.

### Alternative Path C: the counterparty is unreachable
2.1. Jan's phone is off. Sam can still see the tally and its terms — this is his record too, not a
     view of Jan's.
2.2. Anything Sam does that needs Jan is described as pending rather than failed.

## Acceptance Criteria

- [ ] A newly open tally shows a zero balance in the agreed unit
- [ ] Terms in force are readable from each party's own perspective, in both directions
- [ ] The counterparty's disclosed identity is visible, and what was withheld is distinguishable
      from what does not exist
- [ ] A tally with no history is presented as normal, with next actions offered
- [ ] Room to spend is distinguishable from value held
- [ ] Where units differ across tallies, cross-unit totals are marked estimates and never replace the
      per-unit figures
- [ ] Either party may ask to close; with a zero balance it closes without the other's agreement
- [ ] A tally remains readable when the counterparty is unreachable, with pending work described as
      pending

## Variants
- happy: open tally, zero balance, next actions available
- empty: this is the party's only tally
- error: counterparty unreachable; terms cannot be read
