# User Story: Invite someone to tally

## Story Overview

I have someone I trade with and trust. I want a shared record of what we owe each other, so neither
of us has to remember, and so what they owe me is worth something I can use.

Context: Jan has just explained tallies to Sam over lunch ([theory.md](theory.md)). Sam is sitting
across the table and does not have the app. Jan does. Two-party story — Sam's side is
[02](02-respond-to-an-invitation.md).

## Roles

| Role | Who | Has app |
|------|-----|---------|
| Inviter | Jan | yes |
| Invitee | Sam | not yet |

## Sequence

1. Jan starts a new tally. He is not asked who it is for — he is setting out terms, and whoever
   accepts them becomes the other party. He can jot a private note to himself ("bike, lunch
   Tuesday") to tell his outstanding invitations apart; it is his own memo, not a claim about who
   will respond.
2. Jan is asked how much he is willing to be owed by whoever accepts. He thinks about the bike, adds
   some room, and says $500.
3. He is asked how much notice he wants before he can require settlement. He says two weeks.
4. He is told plainly that these are his numbers only — whether the other party extends anything
   back is their decision, and they may extend nothing.
5. He is asked what the tally counts in. Dollars is offered because that is what his other tallies
   use.  CHIPs is also offered.  He is told this one cannot be changed later, so he thinks for a second before confirming.
6. He is asked how long the invitation should stay good. Sam is right there, so a day is plenty.
7. Jan shares the invitation with Sam directly, since they are together.
8. Jan can see the invitation is outstanding and when it runs out. Nothing is owed yet; there is no
   tally until Sam responds.
9. Sam responds. Jan is told, and only now learns who accepted — Sam's identity comes from what Sam
   discloses, not from anything Jan entered. → [02](02-respond-to-an-invitation.md)

### Alternative Path A: Sam never responds
8.1. Sam gets distracted and never opens it. The next day the invitation runs out.
8.2. Jan sees it as expired. It stops asking him for anything.
8.3. Jan can invite Sam again from the same setup, without re-entering the terms he already chose.

### Alternative Path B: Jan changes his mind
8.1. Before Sam responds, Jan decides against it and abandons the invitation.
8.2. If Sam responds anyway, Jan is told, and can simply leave it alone. An invitation Jan never
     agrees to does not become a tally on its own.

### Alternative Path C: Mara's bike shop
1.1. Mara runs the shop and wants to tally with any customer who asks — she cannot know in advance
     who they will be, which is the ordinary case rather than a special one.
1.2. She sets the terms she is willing to offer anyone — a small limit, short notice — and publishes
     one standing invitation.
1.3. Customers use it over the following weeks. Each one ends up with their own separate tally with
     Mara, on those starting terms.
1.4. Mara sees each new tally arrive as its own relationship, and can negotiate any of them
     individually afterward.

### Alternative Path D: Jan is not with Sam
7.1. Sam is not in the room, so Jan sends the invitation to him instead.
7.2. Jan gives it a week rather than a day, since Sam may not look right away.

## Acceptance Criteria

- [ ] The inviter sets terms without naming the other party; whoever accepts becomes that party
- [ ] The inviter may label an invitation privately, without that label asserting who will respond
- [ ] The counterparty's identity comes only from what that party discloses when responding
- [ ] The inviter sets their own credit limit and notice period, and is told these bind only them
- [ ] The unit of account is chosen at invitation time, with the user warned it is permanent
- [ ] The inviter chooses how long the invitation stays good
- [ ] The same invitation can be shared with someone present or sent to someone absent
- [ ] An outstanding invitation is distinguishable from an open tally, and shows when it expires
- [ ] An expired invitation reads as expired and stops requesting attention
- [ ] An expired or abandoned invitation can be re-issued without re-entering its terms
- [ ] A standing invitation produces one separate tally per responder, on the published terms
- [ ] A party with no tallies at all is told what a tally is and offered a way to start one
- [ ] An invitation that cannot be delivered says so, and remains available to share again

## Variants
- happy: invitation shared, response arrives
- empty: Jan's first-ever tally — nothing in his list yet
- error: sharing fails; invitation expires unanswered
