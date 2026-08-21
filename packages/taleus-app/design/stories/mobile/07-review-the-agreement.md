# User Story: Review the agreement

## Story Overview

I agreed to something months ago and I want to check exactly what. What can each of us do, what did
we sign, when did it change, and who is this person I signed it with?

Context: A tally that has been running a while. Sam wants to check where he stands with Jan before
committing to a larger purchase. The same need arises when something surprises a party — a limit
that is lower than remembered, a notice period they meant to change.

## Roles

Either party, from their own side. What each sees of the other is limited to what that party
disclosed.

## Sequence

1. Sam looks at what is currently in force on his tally with Jan.
2. He sees both directions stated from his own point of view: Jan will let him owe up to $500 with
   three weeks' notice; Sam lets Jan owe him nothing.
3. He sees when those terms took effect — this is the third set they have agreed, in force since
   March.
4. He can look back at what came before: the original terms from lunch, and the change they
   negotiated in March. Each shows what changed and when it took effect.
5. He can read the agreement itself — the terms are arguments to a contract both of them signed, and
   he can see which contract that is and what it says.
6. He can see what Jan has disclosed about himself, and that it is Jan's own claim rather than
   anything Taleus vouches for.
7. Sam is satisfied and goes ahead with the purchase.

### Alternative Path A: something is pending
1.1. Jan has proposed new terms that Sam has not answered.
1.2. Sam sees the terms in force and the terms proposed as clearly different things — what binds him
     today, and what would bind him if he agreed.
1.3. Nothing about the proposal changes what he can do right now.

### Alternative Path B: a change that has not taken hold yet
3.1. Jan reduced his limit last week. Because it is restrictive, it does not apply until the notice
     period runs out.
3.2. Sam sees the limit that applies today, the one that will apply, and the date it changes.

### Alternative Path C: Jan has disclosed more since
6.1. Jan added his business address when they started trading in larger amounts.
6.2. Sam can see what Jan has disclosed now. What Jan chose not to disclose is distinguishable from
     what Jan does not have.

### Alternative Path D: reviewing a closed tally
1.1. Sam looks at a tally he closed last year.
1.2. Everything is still readable — terms, history, who the other party was, and that it is closed.

<!--EC  NTA: Alternative path: Jan sees that Sam reduced his limit to $300, and decides he should correspondingly reduce his.  Nothing special, but shows that each takes place at end of call term from initiation. 

KB: Yes, but: I think a call term amendment _could_ kick in immediately on a tally with no outstanding balance.  I think an existing call term is allowed to run its course if a debt was incurred when the old policy was in play.  So call terms run on actual debts, not necessarily from the date of inception of the tally.
-->
<!--EC  NTA: What happens if a party further reduces terms, before the call term? 

KB: Again, I think a debt incurred is resolved according to the terms in play at the time of accrual.  Not sure if this policy will get too messy, but it seems like the right thing to do (to me).
-->


## Acceptance Criteria

- [ ] Terms in force are readable from the reader's own perspective, in both directions
- [ ] The date the current terms took effect is visible
- [ ] Previous terms are available, showing what changed and when it took effect
- [ ] A pending proposal is clearly distinct from the terms in force
- [ ] A change that has not yet taken effect shows both the current value and the effective date
- [ ] The contract behind the terms is identifiable and readable
- [ ] The counterparty's disclosure is visible, and presented as their claim rather than a verified fact
- [ ] What a counterparty withheld is distinguishable from what they lack
- [ ] A closed tally remains fully reviewable

## Variants
- happy: current terms, history, contract, and counterparty all readable
- empty: a tally with only its original terms — no amendments to show
- error: the contract document cannot be retrieved; terms in force still readable
