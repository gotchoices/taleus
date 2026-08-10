# User Story: Respond to an invitation

## Story Overview

As someone who has been invited to tally
I want to understand what I am being offered and decide
So that I only enter a credit relationship I actually want

Context: Continues [01](01-invite-a-partner.md). **Sam** receives Jan's invitation. Sam may not have
the app, may not know what a tally is, and has extended nothing yet.

## Roles

| Role | Who |
|------|-----|
| Invitee | Sam |
| Inviter | Jan (notified of the outcome) |

## Sequence

1. **Sam** opens the invitation — by scanning Jan's code or following his link.
2. If Sam does not have the app, he lands on a page explaining what Taleus is, with a way to get
   the app. Installing and returning brings him back to this same invitation.
3. **Sam** is shown who is inviting him, what Jan is offering, and — in plain language — what a
   tally is and what accepting would mean.
4. **Sam** chooses what to tell Jan about himself. Some of it is required to trade; the rest is
   clearly optional and can be added later.
5. **Sam** states his own side: how much he is willing to be owed by Jan, and his notice period. He
   is told this is separate from what Jan offered him, and that zero is a valid answer.
6. **Sam** accepts.
7. **Jan** is notified that Sam responded, and reviews what Sam disclosed and proposed.
8. **Jan** agrees, and the tally is open for both of them. → [04](04-first-look-at-an-open-tally.md)
   - If Jan wants different terms, this becomes a negotiation. → [03](03-negotiate-terms.md)

### Alternative A: Sam wants different terms
5.1. Sam changes what Jan proposed instead of accepting it.
5.2. This is a counter-offer, and needs Jan's agreement. → [03](03-negotiate-terms.md)

### Alternative B: Sam declines
6.1. Sam dismisses the invitation and it leaves his view.
6.2. Jan is told nothing. From Jan's side the invitation simply runs out its clock.

### Alternative C: too late
1.1. The invitation has already expired.
1.2. Sam is told it is no longer good and offered a way to ask Jan for a new one.

### Alternative D: a standing invitation
1.1. Sam scans a code posted at a shop.
1.2. He is shown the terms the shop offers everyone, and the flow continues from step 3.

## Acceptance Criteria

**Sam (invitee)**
- [ ] Can act on the invitation whether or not he already has the app; installing does not lose it
- [ ] Sees who invited him and what they are offering before disclosing anything
- [ ] Is told what a tally is, in the app, without needing outside explanation
- [ ] Can tell required identifying information from optional
- [ ] Sets his own limit and notice period, separately from Jan's, and may set zero
- [ ] Can accept, counter, or decline
- [ ] Declining removes it from his view and tells Jan nothing
- [ ] An expired invitation is explained as expired, with a way forward

**Jan (inviter)**
- [ ] Is notified when Sam responds, and sees what Sam disclosed and what he proposed
- [ ] Can agree, counter, or leave it
- [ ] Learns nothing when Sam declines or ignores it

## Variants
- happy: Sam accepts, Jan agrees, tally opens
- empty: Sam is a brand-new user with nothing else in the app
- error: invitation expired; disclosure cannot be sent
