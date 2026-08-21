# User Story: Notifications

## Story Overview

I want to hear about the things that actually need me, wherever I am, without the app treating every
event as urgent or announcing my finances to a room.

Context: Sam carries one phone and no always-on machine. Jan has a busy shop, forty tallies, and a
node that runs around the clock.

## Roles

Any party. What reaches them here is only ever things that need *them*
([23](23-what-needs-my-attention.md)).

## Sequence

1. Sam is away from the app when Mara asks him for $95. He is told.
2. What he is told is enough to decide whether to deal with it now: who, what, how much, how long he
   has.
3. He opens it and lands on the request itself, not on a general starting point that makes him find
   it again.
4. Jan answers an offer on his tablet; the notice about it stops mattering on his phone too. He is
   told once, as a person, not once per device.
5. Sam chooses what is worth interrupting him. Something needing a signature is not the same as
   something merely finishing, and he can treat them differently.
6. He can also say when he is not to be disturbed, and what is important enough to override that.

### Alternative Path A: what is happening on its own
1.1. Value moves through Sam's tallies overnight ([31](31-trading-variables.md)).
1.2. He is not woken for it. He already authorized it, and there is nothing for him to do.
1.3. It is there in the morning if he looks. → [24](24-tally-history.md)

### Alternative Path B: the phone has to be woken anyway
1.1. Sam has no always-on machine, so his phone is the only thing that can take part in settling.
1.2. It is roused when it is needed, briefly, without showing him anything — that is participation,
     not a message, and there is nothing for him to read or dismiss.
     1.3. If he never wants that, the honest answer is that his tallies will settle less often, and he is
     told so plainly rather than being quietly cut out. → [13](13-my-devices.md)

### Alternative Path C: on a lock screen, in company
1.1. Sam's phone lights up on a table between other people.
1.2. What shows is enough to know something wants him, without amounts, counterparty names, or
     balances on display to whoever is standing there.
1.3. He can choose to see more at a glance, having been shown what that reveals.

### Alternative Path D: the app is not allowed to notify
1.1. Sam declines notification permission, or turns them off later.
1.2. Nothing breaks, and he is not badgered. He is told once what it costs: things will wait for him
     to look, including requests with deadlines, and his phone may take part in settling less often
     than it otherwise would.
1.3. Anything that was waiting is still waiting when he opens the app.

### Alternative Path E: too many at once
1.1. Jan's shop generates a dozen events in an afternoon.
1.2. He is not given a dozen separate interruptions. Related things arrive together, and what has
     already been dealt with does not announce itself.

### Alternative Path F: stale by the time he looks
1.1. A request expires before Sam gets to it.
1.2. Opening the notice tells him what happened rather than showing him something to act on that no
     longer exists.

## Acceptance Criteria

- [ ] The party is told about things that need them, while the app is closed
- [ ] A notice carries enough to decide whether to act now: who, what, how much, what deadline
- [ ] Acting on a notice lands on the thing itself
- [ ] Dealing with something on one device settles it on the party's other devices
- [ ] The party can distinguish what interrupts them from what merely informs them
- [ ] The party can set quiet periods, and what may override them
- [ ] Automated settling never produces a notification — it needs nothing from the party
- [ ] Background participation is distinguishable from a message, and shows the party nothing
- [ ] Participation by phone alone is presented as best effort, never as a guarantee
- [ ] A party wanting dependable participation is pointed at an always-on machine, not at a setting
- [ ] A party who declines background participation is told the cost, not silently excluded
- [ ] Notices reveal nothing financial to onlookers by default, and the party chooses otherwise
      knowingly
- [ ] Declining notifications entirely breaks nothing, and the cost is stated once
- [ ] Related events arrive together rather than as separate interruptions
- [ ] A notice about something no longer actionable explains itself instead of leading nowhere

## Variants
- happy: a request arrives, is understood at a glance, and is acted on
- empty: a quiet week with nothing needing the party
- error: notifications refused; a dozen at once; a notice that has gone stale
