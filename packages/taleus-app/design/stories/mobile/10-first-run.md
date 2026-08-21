# User Story: First run

## Story Overview

I have just installed this thing. I want to understand what it is and end up ready to use it, without
being asked to make decisions I have no basis for yet.

Context: Steve has followed the MyCHIPs project for years and installs Taleus out of curiosity. He
has no invitation waiting, nobody to tally with, and no idea what the app expects of him. Sam's
route — arriving through someone else's invitation — is the other common case and is covered in
[02](02-respond-to-an-invitation.md).

## Roles

A person with no identity, no tallies, and no counterparty.

## Sequence

1. Steve opens the app for the first time.
2. He is told what Taleus is in a few lines — that a tally is a running account between two people,
   and that value here is what people owe each other. Enough to know whether to continue.
3. An identity is established for him. He is not asked to understand keys, choose an algorithm, or
   name anything cryptographic — this is bookkeeping the app does, and it tells him it has happened
   rather than asking him to do it.
4. He is told, plainly and once, that this identity lives on this device, and what that implies:
   protecting it is worth doing before he holds anything of value. → [12](12-keys-and-backup.md)
5. He is asked for a name to show people he tallies with. Anything else about himself can wait — he
   is told it will be asked for when it matters, and by whom. → [11](11-my-profile-and-disclosure.md)
6. He has no tallies. Rather than an empty list, he is told what he needs — someone to tally with —
   and offered the two ways to get there: invite someone, or accept an invitation someone sends him.
7. Steve is not ready to invite anyone. He looks around, finds nothing broken or alarming, and puts
   his phone away. Nothing he has done so far obliges him to anybody.
8. A week later Jan sends him an invitation, and he picks up at [02](02-respond-to-an-invitation.md)
   with his identity already in place.

### Alternative Path A: Sam's route — invitation first
1.1. Sam installs the app because Jan sent him something, not out of curiosity.
1.2. Setting up his identity happens on the way to answering Jan, not as a separate errand, and he
     lands back on Jan's invitation rather than on an empty app.
1.3. What he is asked about himself is framed by who is asking — Jan — rather than in the abstract.

### Alternative Path B: Steve already has an identity
1.1. Steve is installing on a replacement phone, or a second one.
1.2. He is offered the choice to continue as himself rather than start over, and the app is honest
     that these are different things. → [13](13-my-devices.md), [50](50-recover-after-losing-a-device.md)

### Alternative Path C: no connectivity
1.1. Steve installs on a plane with no signal.
1.2. Everything in this story that does not require another party still works — he ends up with an
     identity and an app that is ready when the network is.
1.3. Anything that genuinely needs the network is described as waiting, not failed.

### Alternative Path D: Steve wants to look before committing
2.1. Steve wants to know what the app does before he is given an identity at all.
2.2. He can see what the app is for without having created anything. Whether an identity exists yet
     is not something he has to care about.


### Alternative Path E: Steve wants to be tallyable
6.1. Steve would rather people came to him than chase them one at a time — he has a workshop and
     customers who might.
6.2. There is nobody to look him up: no directory exists, and he is findable only if he hands
     something out. What he can do is publish an invitation on his own terms and put it where people
     will see it — printed by the till, on a card, in a message.
6.3. He offers strangers no credit; whoever takes it up gets a tally with him and funds it
     themselves. → [01](01-invite-a-partner.md) path C, [21](21-ask-to-be-paid.md) path A
6.4. He can do this before he has ever tallied with anyone.

## Acceptance Criteria

- [ ] A new user is told what Taleus is before being asked for anything
- [ ] An identity is established without requiring the user to understand or manage cryptography
- [ ] The user is told their identity lives on this device, and what that means for them
- [ ] Only a display name is required up front; everything else is deferred until something needs it
- [ ] A user with no tallies is told what they need and offered both ways to get one
- [ ] A user can publish an invitation others can take up, before having any tallies
- [ ] Nothing in first run obliges the user to another party
- [ ] A user arriving via an invitation completes setup on the way to answering it, and returns to it
- [ ] A user with an existing identity can continue as themselves rather than start over
- [ ] First run completes without connectivity, with network-dependent steps described as pending

## Variants
- happy: cold install, identity created, nothing to do yet
- empty: no tallies, no invitation, no history — the normal state at this point
- error: no connectivity during first run
