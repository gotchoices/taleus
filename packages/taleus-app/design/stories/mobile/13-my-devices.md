# User Story: My devices

## Story Overview

More than one thing of mine can act as me. I want to see what they are, add and remove them, and
understand that whether any of them is running decides whether my tallies keep working while I am not
looking.

Context: Steve has a phone and a tablet ([12](12-keys-and-backup.md)). He has begun to notice that
his balances move when he is using the app and sit still when he is not.

## Roles

Any party. A party is not one device — several can act for the same person, and what a party can do
depends on at least one of them being available.

## Sequence

1. Steve can see what acts as him: his phone and his tablet, each recognisable as the thing he owns
   rather than as an identifier he has to decode.
2. For each one he can tell when it was last active, so a device he has not carried in months is
   obvious.
3. He learns something he had not realised: settling value with people he is not directly connected
   to happens on its own, but only while something of his is running and reachable. His phone in his
   pocket, asleep, is not that.
4. He is told what that costs him in his own terms — trades that could have settled overnight waited
   for him instead.
5. He is offered the fix: add something that stays on and is not his phone.
6. Steve adds one. From then on his tallies keep clearing whether or not he is holding a device.
7. He can see it working — that something of his is participating, and when it last did.
8. He sells the tablet. He retires it, and it can no longer act as him.

### Alternative Path A: only a phone
3.1. Steve never adds anything. The app does not pretend this is broken.
3.2. It is honest about the consequence: things that need him will wait until he opens the app, and
     he may miss chances to settle that were only available while he was asleep.

### Alternative Path B: something is off, not gone
2.1. Steve's always-on device loses power for a day.
2.2. He can tell the difference between a device that is temporarily unreachable and one that is
     gone for good — the first needs no action from him.

### Alternative Path C: a device he no longer controls
1.1. Steve's phone is stolen.
1.2. Retiring it is the urgent thing, and the app treats it that way — it can be done from any other
     device of his. → [50](50-recover-after-losing-a-device.md)
1.3. He is told what retiring achieves and what it cannot: the thief can do nothing further as him;
     anything already done stands.

### Alternative Path D: the last one
1.1. Steve tries to retire the only thing that can act as him.
1.2. He is prevented, and told why. → [12](12-keys-and-backup.md)

### Alternative Path E: naming things
1.1. Steve has three devices and cannot tell two of them apart.
1.2. He can name them himself, so the list is meaningful to him rather than to a machine.

## Acceptance Criteria

- [ ] A party can see everything that can currently act as them, recognisably
- [ ] Each device shows when it was last active
- [ ] A party can name their own devices
- [ ] The party is told that automatic settlement depends on something of theirs being available
- [ ] The consequence of having only a phone is stated in terms of what the party misses, not as an
      error or a defect
- [ ] A party can add a device that stays available, and can see it participating
- [ ] A temporarily unreachable device is distinguishable from one that is gone
- [ ] A party can retire a device from any other device they control
- [ ] Retiring is described accurately: it stops future acts, it undoes nothing already done
- [ ] A party cannot retire their last remaining device

## Variants
- happy: two devices, then an always-available one added
- empty: a party with a single phone and nothing else
- error: a device that cannot be reached at the moment it needs retiring

## Open

What an always-available device actually is, and how a party sets one up, depends on platform
capabilities still under development. This story states what the party should be able to see and
decide, not how it is provided — see the `feat-master-key-custody` and `feat-device-and-recovery-surface`
tickets.
