# User Story: Keys and backup

## Story Overview

My ability to act as myself lives on this phone. I want to know that, know what happens if I lose it,
and be able to do something about it before I find out the hard way.

Context: Steve set up an identity in [10](10-first-run.md) and now has two tallies with real value
on them. He has never thought about what his phone is actually holding.

## Roles

Any party. In Taleus a party is not one key on one device — a party's devices act together, so this
story overlaps [13](13-my-devices.md) and [50](50-recover-after-losing-a-device.md).

## Sequence

1. Steve can find out what protects him today: this phone can act as him, and nothing else can.
2. He is told what that means in his terms — if this phone is lost, he keeps his tallies and his
   history, but he loses the ability to agree to anything new on them until he does something about
   it.
3. He is offered ways to be safer, described by what they protect him from rather than by mechanism:
   another device that can also act as him, or a spare means of authority he keeps somewhere off his
   devices entirely — a safe, a deposit box — that could bring a new device back if every device he
   owns is gone.
4. Steve adds his tablet. Now two devices can act as him, and losing either one is an inconvenience
   rather than a crisis. → [13](13-my-devices.md)
5. He can see, at any point, what he is relying on: which devices can act as him, and whether he has
   anything else to fall back on.
6. The app stops asking. Having been told once and acted on it, Steve is not nagged again.

### Alternative Path A: Steve does nothing
3.1. Steve declines to set anything up.
3.2. He is not blocked from using the app — but as value accumulates on his tallies, he is reminded,
     proportionately, that a single device is all that stands between him and a problem.
3.3. The reminder says what he stands to lose, in terms of his actual tallies, not in the abstract.

### Alternative Path B: Steve loses the phone and still has the tablet
1.1. Steve's phone goes into a river. His tablet still acts as him.
1.2. He can carry on, and can retire the lost phone so it can no longer act as him.
1.3. He is told what retiring it does and does not do: it stops that device acting in future; it does
     not undo anything already agreed. → [50](50-recover-after-losing-a-device.md)

### Alternative Path C: Steve loses every device but kept something in the safe
1.1. Phone and tablet both gone. Steve retrieves what he put away.
1.2. He can bring a new device back into service with it, on his own, without asking anyone.

### Alternative Path D: Steve loses everything, with nothing put away
1.1. Every device gone and nothing kept anywhere else.
1.2. His tallies and their history are not lost — they live with his counterparties too — but he
     cannot act on them until someone he trades with vouches for him.
1.3. The app is honest that this route depends on a counterparty's cooperation and their judgment
     about whether it is really him. → [50](50-recover-after-losing-a-device.md)

### Alternative Path E: getting a new phone on purpose
1.1. Steve upgrades and wants his new phone to act as him.
1.2. He can set it up from a device he still has, without involving any counterparty.
1.3. He can retire the old one afterward, and is prompted to, so a phone he has traded in cannot act
     as him.

### Alternative Path F: the last one
1.1. Steve tries to retire the only device that can act as him.
1.2. He cannot — he is prevented, and told why: doing so would leave him unable to act as himself at
     all, recoverable only through a counterparty.

## Acceptance Criteria

- [ ] A party can find out what can currently act as them
- [ ] The consequence of losing a device is stated in terms of what the party can and cannot do
- [ ] Protection options are described by what they protect against, not by mechanism
- [ ] A party can add another device that can act as them
- [ ] A party can retire a device, and is told what retiring does and does not undo
- [ ] A party cannot retire their last remaining means of acting as themselves
- [ ] A party who declines to protect themselves is not blocked, but is reminded as value grows
- [ ] Reminders reference the party's actual holdings rather than generic warnings
- [ ] A party who has protected themselves is not repeatedly prompted
- [ ] Losing every device loses the ability to act, not the tallies or their history
- [ ] Recovery through a counterparty is presented as depending on that party's cooperation
- [ ] A party can keep a spare means of authority away from their devices, and use it alone to bring
      a new device back

## Variants
- happy: one device, then two, then a clear picture of what is relied on
- empty: a brand-new party with nothing at stake yet
- error: a device that can no longer be reached to be retired

## Open

What a party's devices and spare authority can actually do depends on Sereus cadre capabilities that
are still developing — including the off-device master key this story assumes in path C. Written to
stay compatible with that direction rather than to pin it down; see the `feat-master-key-custody`
ticket. Keep this story simple until the platform side settles.
