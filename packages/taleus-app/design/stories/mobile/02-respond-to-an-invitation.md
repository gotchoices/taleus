# User Story: Respond to an invitation

## Story Overview

Someone I know has asked me to tally with them. I want to understand what I am agreeing to before I
agree to it, and to decide for myself how much I am willing to trust them back.

Context: Continues [01](01-invite-a-partner.md). Sam has never used Taleus, does not have the app,
and has extended nothing to anyone. Jan is waiting across the table.

## Roles

| Role | Who |
|------|-----|
| Invitee | Sam |
| Inviter | Jan — told the outcome |

## Sequence

1. Sam opens the invitation Jan just shared with him.
2. He does not have the app. He is told what Taleus is, in terms he can follow without Jan
   explaining it again, and how to get it.
3. He installs it and comes back. He lands on Jan's invitation, not on a blank start — he does not
   have to ask Jan to send it again.
4. Sam sees that Jan is inviting him, that Jan is willing to be owed up to $500, that Jan wants two
   weeks' notice, and that the tally counts in dollars. He has disclosed nothing so far.
5. He is asked what to tell Jan about himself. His name is needed. His phone number and address are
   offered but marked as his choice; he gives his phone number and skips the address.
6. He is asked what he is willing to be owed by Jan. He has no reason to extend Jan credit yet, so he
   says zero, and is told that is a normal answer he can change later.
7. Sam accepts.
8. Jan is notified that Sam responded, and can see what Sam disclosed and what Sam proposed.
9. Jan agrees. Both of them now have an open tally.
   → [04](04-first-look-at-an-open-tally.md)
   - If Jan wants something different, this becomes a negotiation → [03](03-negotiate-terms.md)

### Alternative Path A: Sam wants different terms
6.1. Sam is uneasy about two weeks' notice and wants a month.
6.2. He changes it, which makes this his offer rather than his acceptance. Jan now has to agree.
     → [03](03-negotiate-terms.md)

### Alternative Path B: Sam decides against it
7.1. Sam thinks about it and decides not to. He dismisses the invitation and it leaves his view.
7.2. What Jan sees depends on a decision still being made in the engine — either Jan is told, or the
     invitation simply expires. Sam's side of the story is the same either way.
<!--EC  NTA: I lean towards active rejection in addition to expiration -->

### Alternative Path C: Sam is too late
1.1. Sam finds the message a week later and opens it. The invitation has expired.
1.2. He is told it is no longer good, and offered a way to ask Jan for another.

### Alternative Path D: Sam at Mara's shop
1.1. Sam is buying a tube at Mara's shop and uses the invitation posted by the register.
1.2. He sees the terms Mara offers everyone, and continues from step 4.
1.3. His tally is with Mara alone. Other customers who used the same posted invitation are not part
     of it and cannot see it.

## Acceptance Criteria

- [ ] An invitation can be acted on with or without the app installed; installing does not lose it
- [ ] The invitee sees who is inviting them and on what terms before disclosing anything
- [ ] The app explains what a tally is, without relying on the inviter to have explained it
- [ ] Required identifying information is distinguishable from optional information
- [ ] The invitee sets their own limit and notice period, independently of the inviter's, and zero is
      a valid answer
- [ ] The invitee can accept, counter, or decline
- [ ] Declining removes the invitation from the invitee's view
- [ ] An expired invitation is explained as expired, with a way forward
- [ ] The inviter is told when the invitee responds, and can see what was disclosed and proposed
- [ ] A tally formed from a standing invitation involves only the two parties to it

## Variants
- happy: Sam accepts, Jan agrees, tally opens
- empty: Sam is brand new, with nothing else in the app
- error: invitation expired; disclosure cannot be delivered

## Open

Whether the inviter learns of a decline (alternative B) is being settled in the engine — see the
`feat-offer-lifecycle` ticket. If refusals become visible, this story gains a step where Jan is told.
