# User Story: Negotiate terms

## Story Overview

The terms I was offered are not quite the ones I want. I want to say what I would agree to instead,
see what comes back, and end up with something we both actually chose.

Context: Continues [02](02-respond-to-an-invitation.md) when either side wants something different.
The same flow serves changing the terms of a tally that is already open. Neither party is
privileged — whoever holds the last offer can answer it.

## Roles

| Role | Who |
|------|-----|
| Offerer | whoever made the outstanding offer |
| Responder | the party it is waiting on |

The roles swap with every counter. In this telling Sam counters first.

## Sequence

1. Sam wants a month's notice instead of two weeks. He says so, and sends it back to Jan.
2. He is told this is now his offer — Jan's earlier agreement no longer stands on its own, and Jan
   has to agree to this before anything is settled.
3. Jan is notified that an answer came back, and can see exactly what Sam changed: the notice period, nothing
   else.
4. Jan is not willing to wait a month to be paid, but he will go to three weeks. He changes it and
   sends it back.
5. Sam sees what changed. Three weeks is fine, and he accepts it as it stands.
6. Both of them have now signed the same offer, and the tally is open on those terms.
   → [04](04-first-look-at-an-open-tally.md)

### Alternative Path A: both offers get signed
4.1. Jan's counter and Sam's acceptance of the earlier offer cross paths — both offers end up signed
     by both parties.
4.2. The later-drafted offer is the one in force. Jan and Sam both see the same outcome.
4.3. Each is shown which terms took effect and which were superseded, so neither is left believing
     something different is in force.
4.4. Either can propose again from there. Either can also close the tally if the result is not what
     they wanted — nobody is trapped by it.

### Alternative Path B: it goes stale
3.1. Jan is busy and never answers. Sam's offer expires.
3.2. Neither is left with something waiting on them. Either may offer again.

### Alternative Path C: changing the terms of an open tally
1.1. Months later, Sam asks Jan to raise his limit — the bike turned into a habit.
<!--EC  NTA: might be good to clarify that "asks" isn't just a verbal interaction.  Sam "proposes" this through the system.

KB: This is not the way I had envisioned it.  I had imagined an out-of-band request, followed by a human action by the partner to get in and manually amend the tally.  However, I _am_ open to an in-band command to request a particular credit limit.  Perhaps this is generalized to be _any_ renegotiation request.  We can cover this very lightly in the stories, but the engine may need some fodder to chew on regarding this if we are to extend the protocol to renegotiate an open tally. -->
1.2. The tally keeps working on the existing terms while Jan considers it. Nothing is in limbo.
1.3. Jan agrees, and both can see the new terms and when they took effect.
1.4. The unit is never up for renegotiation; dollars is what this tally counts in for good.

### Alternative Path D: Jan tightens up on his own
1.1. Jan decides $500 was generous and drops his limit to $200. This is his call alone — Sam does not
     have to agree.
1.2. Sam is told. Because the change is restrictive, it takes effect only after the notice Jan
     already owes him, and both can see the date it applies from.
<!--EC  NTA: Should clarify that "notice" = call term -->
<!--EC  NTA: Should clarify that said call notice should be a formal feature of the system - not out of band 

KB: I concur.  -->
1.3. Had Jan raised the limit instead, it would apply at once — nobody needs protection from being
     trusted more.

## Acceptance Criteria

- [ ] The party whose turn it is has the tally waiting on them; the party who is waiting does not
- [ ] Each offer shows what changed from the one before it
- [ ] Countering is presented as replacing agreement, not as editing a live agreement
- [ ] Terms in force and terms proposed are always distinguishable
- [ ] When an offer is accepted, both parties see the same terms took effect
- [ ] If two offers end up fully signed, both parties see the later-drafted one in force, and are
      shown which was superseded
- [ ] An expired offer stops requesting attention and can be re-proposed
- [ ] A tally that is already open keeps working on its existing terms while a new offer is pending
- [ ] A party can change their own limit without the other party's agreement
- [ ] A restrictive change states the date it takes effect; a permissive one applies immediately
- [ ] The unit of account is never offered as negotiable after the first agreement

## Variants
- happy: one counter each way, then agreement
- empty: nothing pending — there is no negotiation to see
- error: two offers signed at once; an offer expires mid-negotiation
