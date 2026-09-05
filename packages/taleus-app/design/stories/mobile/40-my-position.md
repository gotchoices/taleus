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
   because getting there meant valuing Goldbacks and CHIPs at rates he chose himself, and it says
   what it covers — anything he has never priced is named as left out rather than quietly dropped.
   → [41](41-my-exchange-rates.md)
5. Where a rate runs both ways, the figure uses the less flattering one: what he would realise
   converting out today, not what he would pay to acquire. His own position is the last place he
   wants a number that talks him up.
6. He can see how that estimate was arrived at — which holdings were converted and at what rate — so
   it is not a number he has to take on faith.
7. He can see how it got there over time: whether he has been building up or drawing down, over
   months rather than in one instant.
8. What he does *not* see mixed into any of this is credit available to him. Room to spend is not
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

### Alternative Path C: can I afford this?
1.1. Jan is standing in front of something expensive and wants to know whether he can pay for it.
1.2. That is a different question from what he is worth, and he gets a different answer: what he
     could spend, made of two parts kept apart — value people already owe him, and credit others
     have extended him. The first is his; the second is somebody's willingness.
1.3. Neither is added to his net worth, and his net worth is not offered as an answer to this
     question.
1.4. Spending it with the person who extended it is straightforward. Spending it with anyone else
     depends on value being able to reach them, which is not a property of his balance sheet.
     → [30](30-pay-through-the-network.md)

### Alternative Path D: concentration
1.1. Most of what Jan is owed sits with one counterparty.
1.2. He can see that. A single figure hides it; what he is owed and by whom is part of knowing how
     he is doing.

### Alternative Path E: movement in flight
1.1. A payment is routing through Jan's tallies as he looks.
1.2. Settled and unsettled are distinguishable. He is not shown a figure that quietly includes value
     that has not landed.

### Alternative Path F: the first time
1.1. Jan opens this before he has any tallies.
1.2. He is not shown a row of zeros dressed up as a balance sheet. He is told what this will show him
     once he has something, and how to get there.

## Acceptance Criteria

- [ ] What the party is owed and what they owe are shown separately, not only netted
- [ ] Figures are shown per unit, where they are exact
- [ ] An overall figure in the party's chosen unit is available, marked as an estimate, stating what
      it covers and naming what it leaves out
- [ ] Where a rate is directional, the estimate uses the less favourable direction
- [ ] The estimate can be traced: what was converted, at what rate
- [ ] Holdings in units the party has not priced are shown, excluded from the estimate, and the
      exclusion is stated
- [ ] Credit available to the party is never mixed into what they hold
- [ ] Spending power is answerable as its own question, separating value owed to the party from
      credit extended to them
- [ ] Spending power beyond a direct counterparty is presented as depending on reach, not on holdings
- [ ] Settled value is distinguishable from movement not yet complete
- [ ] Position over time is available, not only the present instant
- [ ] Concentration by counterparty is visible
- [ ] A party with nothing yet is told what this will show, not shown empty totals

## Variants
- happy: mixed units, an estimate the party can trace
- empty: no tallies yet
- error: an unpriced unit; movement in flight at the moment of asking
