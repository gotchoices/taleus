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
   weeks' notice, that the tally counts in dollars, and which agreement governs it. He can read that
   agreement before agreeing to anything, and he has disclosed nothing so far.
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
7.1. Sam thinks about it and decides not to. He refuses it, and can say why if he wants to.
7.2. Jan is told. He is not left watching a clock, wondering whether Sam ever looked.
7.3. That offer is finished — refusing it is not a pause, and it cannot be revived by either of them.
7.4. The relationship is not finished. Jan can come back with better terms, and Sam can consider
     those on their own merits. → [03](03-negotiate-terms.md)
7.5. Sam can also simply ignore it, in which case it expires and Jan learns only that.

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
- [ ] The invitee sees who is inviting them, on what terms, and under which agreement, before
      disclosing anything
- [ ] The governing agreement is readable before the invitee commits
- [ ] The app explains what a tally is, without relying on the inviter to have explained it
- [ ] Required identifying information is distinguishable from optional information
- [ ] The invitee sets their own limit and notice period, independently of the inviter's, and zero is
      a valid answer
- [ ] The invitee can accept, counter, refuse, or ignore
- [ ] A refusal reaches the inviter; an ignored invitation simply expires
- [ ] A refused offer cannot be revived; a fresh offer on new terms can always be made
- [ ] An expired invitation is explained as expired, with a way forward
- [ ] The inviter is told when the invitee responds, and can see what was disclosed and proposed
- [ ] A tally formed from a standing invitation involves only the two parties to it

## Variants
- happy: Sam accepts, Jan agrees, tally opens
- empty: Sam is brand new, with nothing else in the app
- error: invitation expired; disclosure cannot be delivered

