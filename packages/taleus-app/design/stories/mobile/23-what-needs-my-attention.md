# User Story: What needs my attention

## Story Overview

I hold a lot of tallies and I do not want to visit each one to find out whether anybody is waiting on
me. Show me what is mine to act on, and leave me alone about everything else.

Context: Jan holds forty-odd tallies. Today: Sam has countered his terms, Mara has asked him for
$240, a supplier's invitation is still unanswered, and one tally is closing but not yet settled.
Meanwhile value has been moving through his tallies all week without him.

## Roles

Any party with more tallies than they can hold in their head.

## Sequence

1. Jan opens the app and, without looking for it, can tell whether anything is waiting on him.
2. Four things are: an offer to answer, a request to pay, an invitation that has been taken up, and a
   tally that cannot finish closing until a balance settles.
3. Each one says what it is and what it would cost him to deal with — the amount, the counterparty,
   how long it has been waiting.
4. He deals with the request first because it is the largest, then the offer.
   → [22](22-respond-to-a-request.md), [03](03-negotiate-terms.md)
5. As he deals with each, it stops asking. Nothing lingers demanding attention it no longer needs.
6. What is *not* here is as important as what is. Value moved through his tallies all week under the
   settings he signed, and none of it interrupted him — he authorized that when he set those
   settings, not each time it happened. → [31](31-trading-variables.md)
7. Two of his tallies are waiting on the other party. They are visible if he goes looking, but they
   are not asking anything of him.

### Alternative Path A: nothing is waiting
1.1. Most days, nothing needs Jan.
1.2. He is told that plainly. An empty list is a good state and reads like one, not like a failure to
     load.

### Alternative Path B: something is time-limited
2.1. Mara's request runs out on Friday; Sam's offer next month.
2.2. Jan can tell which is urgent from which is merely open, without reading dates and doing the
     arithmetic himself.
2.3. When something does run out unanswered, it stops asking and he can see that it lapsed rather
     than that he dealt with it.

### Alternative Path C: too much at once
1.1. After a week away, eleven things are waiting.
1.2. Jan can work through them without losing his place, and can tell what he has already handled
     this session.

### Alternative Path D: something he cannot finish
2.1. The closing tally needs the other party to settle before it can complete.
2.2. It appears, because Jan should know about it, but it is honest that the next move is not his —
     it is waiting on someone else, not on him.

### Alternative Path E: on another device
1.1. Jan answers the offer on his tablet.
1.2. It stops asking on his phone too. Attention is his, not his device's.

## Acceptance Criteria

- [ ] A party can tell whether anything needs them without visiting individual tallies
- [ ] Each waiting item states what it is, who it involves, what it would cost, and how long it has
      waited
- [ ] Items waiting on the party are distinguishable from items waiting on the counterparty
- [ ] Dealing with an item stops it asking, on every device the party uses
- [ ] Items with a deadline are distinguishable from open-ended ones without the user doing date
      arithmetic
- [ ] An item that lapses unanswered is distinguishable from one that was dealt with
- [ ] Automated clearing never appears here — it was authorized in advance and needs nothing
- [ ] Something waiting on the other party may be shown, but never as a demand on this party
- [ ] Having nothing waiting is presented as a normal, good state

## Variants
- happy: four things waiting, worked through
- empty: nothing needs the party — the ordinary day
- error: eleven items after a week away; an item that cannot be resolved by this party
