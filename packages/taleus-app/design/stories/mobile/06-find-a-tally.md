# User Story: Find a tally

## Story Overview

I have more tallies than I can hold in my head. I want to get to the one I mean, using whatever I
happen to remember about it.

Context: Jan has been trading for a year and holds forty-odd tallies — most quiet, a few active, a
couple in units other than dollars. Sam, by contrast, has three.

## Roles

Any party with more than a handful of tallies. What a party can find is limited to their own.

## Sequence

1. Jan wants the tally he holds with Mara's bike shop. He remembers the shop, not the terms.
2. He finds it by who it is with.
3. Later he wants "the one in hours" — he cannot remember whose it is, only that it is not in
   dollars. He finds it by the unit it counts in.
4. Later still he wants the one he was arguing about last week. He finds it among those that have
   changed recently.
5. Whatever he was looking for, he ends up at the tally itself and can act on it.

### Alternative Path A: what needs Jan
1.1. Jan opens the app with no particular tally in mind, wanting to know whether anything is waiting
     on him.
1.2. Two tallies need him: an offer to answer and a request to approve. He can get to both without
     hunting through the other thirty-eight.
1.3. Tallies where he is waiting on someone else are not confused with tallies waiting on him.
     → [23](23-what-needs-my-attention.md)

### Alternative Path B: a name that is not unique
2.1. Jan holds three tallies with people called Chen.
2.2. He can tell them apart by what else he knows — what they trade in, what is outstanding, when
     they were last active.

### Alternative Path C: not yet a tally
1.1. Jan is looking for an invitation he sent last week that has not been answered.
1.2. Outstanding invitations are findable too, and are not mistaken for open tallies.

### Alternative Path D: Sam's three tallies
1.1. Sam has three tallies and no trouble finding any of them.
1.2. Nothing about finding gets in his way — the effort of locating a tally scales with how many a
     party has.

### Alternative Path E: closed ones
3.1. Jan wants a tally he closed last spring, to check what it was.
3.2. Closed tallies are findable, and are not mixed in with the ones he is still trading on.

## Acceptance Criteria

- [ ] A party can reach a tally by who it is with
- [ ] A party can reach a tally by the unit it counts in
- [ ] A party can reach a tally by how recently something happened on it
- [ ] Tallies waiting on the party are reachable without searching for them individually
- [ ] Tallies waiting on the counterparty are distinguishable from tallies waiting on the party
- [ ] Counterparties with similar names are distinguishable by other attributes
- [ ] Outstanding invitations are findable and distinct from open tallies
- [ ] Closed tallies are findable and distinct from open ones
- [ ] A party with few tallies is not made to work as if they had many

## Variants
- happy: forty tallies, several ways in
- empty: a party with no tallies at all — nothing to find, and told what to do instead
- error: a tally whose counterparty details cannot be loaded is still findable and identifiable
