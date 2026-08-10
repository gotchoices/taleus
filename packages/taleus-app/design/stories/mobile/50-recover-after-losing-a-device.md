# User Story: Recover after losing a device

## Story Overview

I lost the phone I do this on. I want to get back to being able to act as myself — and to know that
what I hold is not gone with it.

Context: Sam's phone is stolen on a trip. His tallies with Jan, Mara, and a supplier hold real value.
This story also covers Steve, who lost every device he had ([12](12-keys-and-backup.md)). The
total-loss half is told from both sides, because it asks something real of the other party — and
because it happens outside the app entirely.

## Roles

| Role | Who |
|------|-----|
| Recovering party | Sam, then Steve |
| Surviving counterparty | Jan — approached directly by Steve, outside the app |

## Sequence

1. Sam realises the phone is gone. The first thing he wants is for it to stop being able to act as
   him.
2. From his tablet, he retires the lost phone. Anything the thief tries afterward is refused.
3. He is told what that did and did not do: nothing further can be done as him from that phone;
   anything already done stands.
4. Sam checks what he still has. His tallies, balances, history, and terms are all intact — they were
   never only on that phone.
5. He sets up a replacement phone from his tablet, without involving anyone he trades with.
6. He is back to normal, and can see that two devices act as him again. → [13](13-my-devices.md)

### Alternative Path A: Steve has nothing left, but planned ahead
1.1. Steve lost every device and has no second one to work from.
1.2. He retrieves what he put away for this ([12](12-keys-and-backup.md)) and re-establishes himself
     on a new device with it.
1.3. He does this alone. Nobody he trades with is involved or even aware.

### Alternative Path B: Steve has nothing left and did not plan ahead
1.1. No devices, nothing put away.
1.2. His tallies still exist — they live with his counterparties as much as with him — but he has no
     way to act on them.
1.3. Nothing about this is solved inside the app. Steve contacts Jan the way he would if a bank card
     had gone missing: he calls him, or turns up. No request arrives in Jan's app asking him to
     authorize anybody, and the app never presents one — a message claiming to be a recovery request
     would be the easiest way to rob him.
1.4. **Jan's side.** Jan satisfies himself, by his own means, that this is really Steve. That
     judgment is entirely his and happens entirely outside the app.
1.5. Once satisfied, Jan can act. What he owes Steve does not evaporate because Steve lost a phone:
     he can settle what is between them and open a fresh tally with Steve's new identity, so the
     value survives even though the old tally does not.
1.6. Steve is back in business with Jan, on a new footing, and repeats this with anyone else he
     traded with.

### Alternative Path C: Jan cannot satisfy himself
1.1. Jan is not sure, or does not want the responsibility.
1.2. He is under no obligation and nothing in the app pressures him. He can still settle what he owes
     and leave it there.
1.3. Steve's other tallies are untouched; he can approach each counterparty separately, and one
     saying no does not affect the rest.

### Alternative Path D: someone pretending to be Steve
1.1. A stranger calls Jan claiming to be Steve, needing help getting back in.
1.2. Because nothing in the app carries such a request, there is no official-looking prompt for the
     stranger to hide behind. Jan is dealing with a phone call, and treats it as one.
1.3. If Jan is fooled, what he has done is trade with a stranger — bounded by the terms he sets on
     that new tally — rather than hand over Steve's whole identity.

### Alternative Path E: the thief moves first
2.1. Sam cannot reach any device to retire the stolen phone — he is somewhere without connectivity.
2.2. The app is honest that retiring cannot take effect until he can reach the network, and does not
     claim it has been done when it has not.

### Alternative Path F: getting the old phone back
2.1. The phone turns up a week later, after Sam retired it.
2.2. It no longer acts as him. He can put it back into service deliberately if he wants, as a new
     device rather than by undoing the retirement.

## Acceptance Criteria

**Recovering party**
- [ ] Retiring a lost device is reachable from any other device the party controls
- [ ] The party is told what retiring does and does not undo
- [ ] Tallies, balances, history, and terms survive the loss of any or all devices
- [ ] A party with another device can restore themselves without involving a counterparty
- [ ] A party with something put away can restore themselves without involving a counterparty
- [ ] A party with neither is directed to their counterparties directly, outside the app
- [ ] Losing everything costs the party their ability to act, not the value their counterparties owe
- [ ] Retiring that cannot yet take effect is reported honestly, never as done

**Surviving counterparty**
- [ ] The app never presents an unsolicited request to re-authorize or vouch for anyone
- [ ] A counterparty who has satisfied themselves out of band can settle up and start a fresh tally
- [ ] A counterparty is never pressured to help, and declining harms nothing
- [ ] What one counterparty decides does not affect the party's other tallies

## Variants
- happy: lost phone retired, replacement set up from a second device
- empty: a party with a single device and nothing put away — the hardest case
- error: no connectivity to retire; a caller who cannot be verified

## Open

Two things here are deliberately left to the engine project, and this story is written to survive
either answer:

- What a party can put away in advance, and what it can do — `feat-master-key-custody`.
- Whether a surviving counterparty can ever admit a *new* signing identity to an *existing* tally,
  rather than settling up and starting a fresh one. That would preserve the relationship's history,
  but it is an identity-substitution path and needs a security analysis before it is designed —
  `feat-total-loss-recovery`. Until then this story takes the conservative route: a new tally.
