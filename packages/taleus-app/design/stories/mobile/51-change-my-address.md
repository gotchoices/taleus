# User Story: Staying reachable

## Story Overview

I have changed phones, moved house, switched providers. I want the people I trade with to still be
able to reach me, and I want to know when something I sent out has gone stale.

Context: Jan replaces his phone, then later moves his always-on node to a different provider. He has
forty tallies and two outstanding invitations he handed out last month.

## Roles

Any party whose machines change. Counterparties are affected only when something stops working.

## Sequence

1. Jan replaces his phone and sets the new one up ([13](13-my-devices.md)).
2. His tallies keep working. Nobody he trades with has to do anything, and he is not asked to tell
   anyone his new details — how his machines are found is the platform's business, not a thing he
   maintains.
3. Later he moves his node to a different provider. Same result: his counterparties notice nothing.
4. What does not carry over is anything he handed out earlier. The two invitations still sitting in
   people's inboxes were made when his old machines answered.
5. He is told which of those are affected and offered the obvious remedy: issue fresh ones
   ([01](01-invite-a-partner.md)).
6. Nothing about his identity changed through any of this. He is the same party to everyone he trades
   with, with the same history.

### Alternative Path A: a counterparty cannot reach him
1.1. Sam tries to act on their tally while Jan is between machines.
1.2. Sam is told it cannot be reached right now, not that Jan is gone or that something is wrong with
     the tally.
1.3. Whatever Sam wanted to do waits, and completes when Jan is reachable again.

### Alternative Path B: Jan cannot reach a counterparty
1.1. Jan sees a tally that has not been reachable for weeks.
1.2. He can see when that tally was last reached, and whether anything of his own is having trouble.
     Why the other side is quiet is not something he can know from here — it may be their machines,
     the network between them, or simply nobody home.
1.3. The remedy is human — call them — rather than anything the app can fix.

### Alternative Path C: what people actually see of him
1.1. Jan wonders what his counterparties know about where he is.
1.2. What they see is what he disclosed to them ([11](11-my-profile-and-disclosure.md)) — a name, a
     phone number, whatever he chose. That is separate from how his machines are found, and changing
     one is not changing the other.

## Acceptance Criteria

- [ ] Replacing or moving machines requires no action toward counterparties
- [ ] A party is never asked to maintain their own reachability details by hand
- [ ] Outstanding invitations affected by a change are identified, with re-issuing offered
- [ ] A party's identity and history are unchanged by any machine change
- [ ] A counterparty who cannot be reached is described as unreachable, not as missing or broken
- [ ] Work blocked by unreachability waits and completes rather than failing
- [ ] A party can see when each tally was last reached, and whether their own side is at fault
- [ ] The app does not speculate about why a counterparty is unreachable
- [ ] Disclosed contact information is presented as separate from how machines find each other

## Variants
- happy: phone replaced, provider changed, nothing to tell anybody
- empty: a party who has never changed anything
- error: a stale invitation; a counterparty unreachable for weeks

## Open

MyCHIPs had an explicit user-chosen address that a person could change (`UpdateCUID`). Taleus has no
such thing — reachability follows from a party's machines. If that holds, this story is mostly about
stale invitations and honest unreachability, and it may be better folded into
[14](14-my-cadre.md) than kept separate.
