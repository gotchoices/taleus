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
6.2. Sam can see what Jan has disclosed now. What is absent stays ambiguous — withheld and never-held
     look the same from here — and if it matters, Sam can ask.
     → [11](11-my-profile-and-disclosure.md)

### Alternative Path D: matching a reduction
1.1. Sam has cut what he will let Jan owe him from $500 to $300. Jan sees it, and decides to cut his
     side to match.
1.2. Neither reduction reaches back. What Sam already owes stays under the terms it was borrowed
     under; the new figure governs what happens from here.
1.3. Each of them can see which terms apply to what: the balance already outstanding, and anything
     from now on.
1.4. With nothing outstanding, a reduction simply applies — there is no debt whose runway it could
     shorten, so there is nothing to wait for.

### Alternative Path E: a second reduction, before the first has taken hold
1.1. Jan cuts his limit again a week later, before the earlier cut has taken effect.
1.2. It changes nothing about the money already advanced, which keeps the terms in force when it was
     advanced. Reductions stack on the future, not on the past.
1.3. Both of them can see each change, when it was made, and what it governs.

### Alternative Path F: reviewing a closed tally
1.1. Sam looks at a tally he closed last year.
1.2. Everything is still readable — terms, history, who the other party was, and that it is closed.



## Acceptance Criteria

- [ ] Terms in force are readable from the reader's own perspective, in both directions
- [ ] The date the current terms took effect is visible
- [ ] Previous terms are available, showing what changed and when it took effect
- [ ] A pending proposal is clearly distinct from the terms in force
- [ ] A change that has not yet taken effect shows both the current value and the effective date
- [ ] It is visible which terms govern value already outstanding and which govern new activity
- [ ] Successive changes are individually visible, each with what it governs
- [ ] A restrictive change on a tally with nothing outstanding is shown as applying immediately
- [ ] The contract behind the terms is identifiable and readable
- [ ] The counterparty's disclosure is visible, and presented as their claim rather than a verified fact
- [ ] Absent information is not presented as evidence of anything about the counterparty
- [ ] A closed tally remains fully reviewable

## Variants
- happy: current terms, history, contract, and counterparty all readable
- empty: a tally with only its original terms — no amendments to show
- error: the contract document cannot be retrieved; terms in force still readable
