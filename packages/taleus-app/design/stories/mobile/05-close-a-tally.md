# User Story: Close a tally
<!--EC  NTA: I wonder if another term would conjure more intuition.  e.g. "clear out", "zero out". -->

## Story Overview

This relationship has run its course. I want to wind it down cleanly — no more building up on either
side, settle what is outstanding, and end it — without needing the other party's permission to start.

Context: Continues [04](04-first-look-at-an-open-tally.md). Months on, Sam and Jan's tally has seen
the bike, some lunches, and a repair job. Sam owes Jan $180. Sam is moving away.

## Roles

Either party may ask to close. In this telling Sam asks; the alternatives cover Jan asking, both
asking, and nobody being able to settle.

## Sequence

1. Sam asks to close the tally.
<!--EC  NTA: "asks" sounds like a person-to-person informal request.  "submits a request" might better suggest that the request is through the system -->
2. He is told what that means before it happens: the balance can no longer grow in either
   direction, what he owes does not go away, and the tally ends when the balance reaches zero.
   Settling it is still allowed — that is the point.
3. Jan is told the tally is closing. He does not get to refuse it — he keeps everything he is owed,
   and closing does not forgive it.
<!--EC  NTA: told -> notified -->
4. The tally now shows as closing to both of them. What each can still do has narrowed to one
   direction: anything that moves the balance toward zero goes through, anything that would move it
   further from zero does not. Sam can pay Jan; Sam cannot spend more against Jan's credit.
5. Sam settles the $180 — all at once, or in pieces over several weeks. Each payment is allowed
   because each one moves the balance toward zero.
6. The balance reaches zero and the tally closes for both of them.
<!--EC  NTA: We may consider a "margin" so that tallies aren't hung up on fractions of a cent or even fractions of a dollar -->
7. Both keep the record. A closed tally is still readable: what happened, what was agreed, who the
   other party was.

### Alternative Path A: Jan closes it and writes it off
1.1. Jan is the one who wants out, and would rather forgive the $180 than chase it.
1.2. He asks to close and gives Sam the balance back — permitted precisely because it moves the
     balance to zero.
<!--EC  NTA: "asks" -> "requests" -->
1.3. The tally closes immediately. Sam is told, and owes nothing.
<!--EC  NTA: "told" -> "notified" -->

### Alternative Path B: nothing is owed
1.1. Sam and Jan are square when Sam asks to close.
1.2. There is nothing to settle, so the tally closes right away.

### Alternative Path C: Sam cannot pay
5.1. Sam has no way to settle the $180 right now.
5.2. The tally stays closing for as long as that takes. It does not disappear, and Jan's $180 stays
     recorded and collectible.
5.3. Both of them can see it is waiting on settlement rather than finished.
5.4. If Sam settles a year later, it closes then.
<!--EC  NTA: No mention of being "late".  Potential late and/or collection fees in the contract? -->

### Alternative Path D: closing while something is in flight
5.1. A payment routed through this tally is still in progress when the balance would otherwise hit
     zero.
5.2. The tally does not close yet — closing waits until nothing is outstanding, so a payment landing
     later cannot reopen something already called finished.

### Alternative Path E: both ask
3.1. Jan asks to close in the same week Sam does.
3.2. Nothing changes — one request was already enough, and a second does not make it more closed.

## Acceptance Criteria

- [ ] Either party can ask to close, at any time, without the other's agreement
- [ ] The consequences are stated before closing begins: no further activity, the balance still owed
- [ ] A closing tally accepts entries that move the balance toward zero, from either party
- [ ] A closing tally refuses anything that would move the balance further from zero
- [ ] Closing does not forgive, reduce, or endanger what is owed
- [ ] A tally with a settled balance of zero closes; one with a balance stays closing until settled
- [ ] A creditor may return the balance to bring it to zero, and the tally then closes
- [ ] A tally with something still in flight does not close until that resolves
- [ ] A tally that stays closing is presented as awaiting settlement, not as broken or finished
- [ ] A second close request changes nothing
- [ ] A closed tally remains readable — history, terms, and counterparty

## Variants
- happy: close requested, balance settled, tally closes
- empty: nothing owed, closes immediately
- error: cannot settle; closing persists indefinitely
