# User Story: Close a tally

## Story Overview

This relationship has run its course. I want to wind it down cleanly — nothing more building up on
either side, settle what is outstanding, and end it — without needing the other party's permission to
start.

Context: Continues [04](04-first-look-at-an-open-tally.md). Months on, Sam and Jan's tally has seen
the bike, some lunches, and a repair job. Sam owes Jan $180. Sam is moving away.

## Roles

Either party may request a close, through the app rather than by asking the other party for it. In
this telling Sam requests it; the alternatives cover Jan requesting, both requesting, and nobody being
able to settle.

## Sequence

1. Sam requests that the tally be closed.
2. He is told what that means before it happens: the balance can no longer grow in either
   direction, what he owes does not go away, and the tally ends when the balance reaches zero.
   Settling it is still allowed — that is the point.
3. Jan is notified that the tally is closing. He does not get to refuse it — he keeps everything he is owed,
   and closing does not forgive it.
4. The tally now shows as closing to both of them. What each can still do has narrowed to one
   direction: anything that moves the balance toward zero goes through, anything that would move it
   further from zero does not. Sam can pay Jan; Sam cannot spend more against Jan's credit.
5. Sam settles the $180 — all at once, or in pieces over several weeks. Each payment is allowed
   because each one moves the balance toward zero.
6. The balance reaches zero and the tally closes for both of them.
7. Both keep the record. A closed tally is still readable: what happened, what was agreed, who the
   other party was.

### Alternative Path A: Jan closes it and writes it off
1.1. Jan is the one who wants out, and would rather forgive the $180 than chase it.
1.2. He requests the close and gives Sam the balance back — permitted precisely because it moves the
     balance to zero.
1.3. The tally closes immediately. Sam is notified, and owes nothing.
1.4. The same applies to a remainder too small to chase. Nothing is rounded away on anybody's behalf:
     the party owed hands back the last few cents themselves, deliberately, so the write-off is an
     act with an author and a place in their books.
1.5. Where a closing tally is held up by a remainder that is plainly not worth anyone's time, the
     party who is owed it — and only that party, since it is theirs to give up — is offered the
     write-off, with the amount shown. Taking it is one ordinary act of giving value, and it lands in
     the history like any other. Declining leaves the tally exactly where it was, and the offer does
     not come back to nag.
### Alternative Path B: nothing is owed
1.1. Sam and Jan are square when Sam requests the close.
1.2. There is nothing to settle, so the tally closes right away.

### Alternative Path C: Sam cannot pay
5.1. Sam has no way to settle the $180 right now.
5.2. The tally stays closing for as long as that takes. It does not disappear, and Jan's $180 stays
     recorded and collectible.
5.3. Both of them can see it is waiting on settlement rather than finished.
5.4. If Sam settles a year later, it closes then.
5.5. If a date they agreed to has passed, both of them see that plainly. Nothing is added to the
     balance for lateness — no charge appears that neither of them entered.
5.6. Whatever their agreement says about being late is between them and that agreement, to be
     resolved as people resolve things. The app records; it does not adjudicate.

### Alternative Path D: closing while something is in flight
5.1. A payment routed through this tally is still in progress when the balance would otherwise hit
     zero.
5.2. The tally does not close yet — closing waits until nothing is outstanding, so a payment landing
     later cannot reopen something already called finished.

### Alternative Path E: Sam changes his mind
4.1. Partway through settling, Sam and Jan patch things up and want to carry on.
4.2. Sam withdraws his close request. The tally is open again, on the terms it always had, and both
     of them can see that it was closing and no longer is.
4.3. This works only while it is still closing. Once the balance reaches zero and the tally closes,
     that is final — carrying on means a new tally.

### Alternative Path F: both request
3.1. Jan requests a close in the same week Sam does.
3.2. Nothing changes — one request was already enough, and a second does not make it more closed.
3.3. Withdrawing works the same way: while either party's request stands, the tally is still closing.

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
- [ ] A party can withdraw their own close request while the tally is still closing
- [ ] A tally is still closing while any party's request stands
- [ ] Nothing is written off automatically; a remainder is forgiven by a deliberate act with an author
- [ ] A closing tally stuck on a trivial remainder offers the write-off to the party owed it, showing
      the amount, and accepts a refusal without repeating itself
- [ ] A missed settlement date is shown to both parties, with nothing added to the balance for it
- [ ] The app never adjudicates lateness or applies penalties on its own
- [ ] A closed tally remains readable — history, terms, and counterparty

## Variants
- happy: close requested, balance settled, tally closes
- empty: nothing owed, closes immediately
- error: cannot settle; closing persists indefinitely; an agreed date passes unsettled
