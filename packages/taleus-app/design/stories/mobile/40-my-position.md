# User Story: My position

## Story Overview

I want to know how I am doing overall — what I am owed, what I owe, and what that leaves me worth —
in a unit I actually think in, without being misled about how precise that is.

Context: Jan holds forty tallies. Most are in dollars, three are in Goldbacks, one is in CHIPs.
Some hold value for him; on others he is the one who owes. He has never had a single figure for any
of it.

## Roles

Any party with more than one tally. What they see is their own position; nothing here is visible to
anyone else.

## Sequence

1. Jan checks to see how he is doing.
2. He sees what he is owed and what he owes as two separate quantities, not merely the difference —
   being owed $9,000 and owing $8,000 is a different life from being owed $1,000 and owing nothing.
3. Both are broken out by unit, because that is where the figures are real: dollars with dollars,
   Goldbacks with Goldbacks.
4. He also sees one overall figure in dollars, the unit he thinks in. It is marked as an estimate,
   because getting there meant valuing Goldbacks and CHIPs at rates he chose himself.
   → [41](41-my-exchange-rates.md)
5. He can see how that estimate was arrived at — which holdings were converted and at what rate — so
   it is not a number he has to take on faith.
6. He can see how it got there over time: whether he has been building up or drawing down, over
   months rather than in one instant.
7. What he does *not* see mixed into any of this is credit available to him. Room to spend is not
   value he holds; treating it as such is the mistake the whole system exists to avoid.

### Alternative Path A: everything in one unit
1.1. Sam holds three tallies, all in dollars.
1.2. There is no estimating to do and nothing to mark as approximate. His position is simply his
     position.

### Alternative Path B: a unit Jan has never priced
3.1. Jan takes a tally denominated in something he has no rate for.
3.2. That holding appears in its own unit, honestly, and is left out of the overall estimate rather
     than being guessed at — with the omission stated, not silent.
3.3. He is offered the chance to price it, which would fold it in. → [41](41-my-exchange-rates.md)

### Alternative Path C: concentration
1.1. Most of what Jan is owed sits with one counterparty.
1.2. He can see that. A single figure hides it; what he is owed and by whom is part of knowing how
     he is doing.

### Alternative Path D: movement in flight
1.1. A payment is routing through Jan's tallies as he looks.
1.2. Settled and unsettled are distinguishable. He is not shown a figure that quietly includes value
     that has not landed.

### Alternative Path E: the first time
1.1. Jan opens this before he has any tallies.
1.2. He is not shown a row of zeros dressed up as a balance sheet. He is told what this will show him
     once he has something, and how to get there.

## Acceptance Criteria

- [ ] What the party is owed and what they owe are shown separately, not only netted
- [ ] Figures are shown per unit, where they are exact
- [ ] An overall figure in the party's chosen unit is available, marked as an estimate
- [ ] The estimate can be traced: what was converted, at what rate
- [ ] Holdings in units the party has not priced are shown, excluded from the estimate, and the
      exclusion is stated
- [ ] Credit available to the party is never mixed into what they hold
- [ ] Settled value is distinguishable from movement not yet complete
- [ ] Position over time is available, not only the present instant
- [ ] Concentration by counterparty is visible
- [ ] A party with nothing yet is told what this will show, not shown empty totals

## Variants
- happy: mixed units, an estimate the party can trace
- empty: no tallies yet
- error: an unpriced unit; movement in flight at the moment of asking
