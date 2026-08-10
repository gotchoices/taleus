# User Story: Invite someone to tally

## Story Overview

As someone who wants to trade on credit with a person I trust
I want to invite them to open a tally with me
So that we have a shared record of what we owe each other

Context: Two-party story. **Jan** is the inviter; **Sam** is the invitee and does not have the app.
Jan has the app and an identity. This story ends when the invitation is out; Sam's side is
[02](02-respond-to-an-invitation.md).

## Roles

| Role | Who | Has app |
|------|-----|---------|
| Inviter | Jan | yes |
| Invitee | Sam | not yet |

## Sequence

1. **Jan** starts a new tally and names who it is for, in his own words ("Sam — bike").
2. **Jan** states how much he is willing to be owed by Sam, and how much notice he wants before the
   balance must settle. He is told this is his side only — Sam decides separately what to extend to
   Jan.
   - If Jan is unsure, he can offer zero and raise it later.
3. **Jan** picks what the tally counts in. It defaults to the unit he uses most; whatever he picks
   here cannot change later.
4. **Jan** chooses how long the invitation stays good.
5. **Jan** sends it — as a QR code for someone in the room, or as a link he can text, email, or
   message.
6. **Jan** sees the tally in his list as awaiting a response, with the time remaining.
7. **Jan** is notified when Sam responds. → [02](02-respond-to-an-invitation.md)

### Alternative A: nobody responds
6.1. The invitation's time runs out; the tally shows as expired and stops asking for attention.
6.2. Jan can send a fresh invitation from the same setup without re-entering anything.

### Alternative B: Jan changes his mind
6.1. Jan abandons the pending tally.
6.2. If Sam responds anyway, Jan is told, and is free to leave it — an unanswered invitation
     never becomes an agreement on its own.

### Alternative C: a standing invitation (vendor)
5.1. Jan runs a shop and wants one code that any customer can use.
5.2. He publishes a standing invitation with the terms he offers everyone.
5.3. Each customer who uses it gets their own separate tally with Jan, on those terms.
5.4. Jan sees each new tally arrive individually.

## Acceptance Criteria

**Jan (inviter)**
- [ ] Can state his own credit limit and notice period, and is told they are his side only
- [ ] Can choose the unit of account, and is warned it is permanent
- [ ] Can set how long the invitation is good for
- [ ] Can share by QR or by link, from the same tally
- [ ] Sees pending invitations with time remaining, distinct from open tallies
- [ ] Sees an expired invitation as expired, not as an open item needing attention
- [ ] Can re-send an expired invitation without re-entering the terms
- [ ] A standing invitation yields one separate tally per responder

**Empty / error**
- [ ] With no tallies at all, the app explains what a tally is and offers to invite someone
- [ ] An invitation that cannot be shared (no network) reports it plainly and stays pending

## Variants
- happy: invitation sent, response arrives
- empty: first-ever tally, nothing in the list
- error: sharing fails; invitation expires unanswered
