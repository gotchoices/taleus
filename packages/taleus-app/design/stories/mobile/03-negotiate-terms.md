# User Story: Negotiate terms

## Story Overview

As a party to a proposed tally
I want to counter what the other side proposed until we agree
So that the terms we sign are ones we both chose

Context: Continues [02](02-respond-to-an-invitation.md) when either side wants different terms. The
same flow applies **after** a tally is open, to change terms of a running tally. Neither party is
privileged: whoever received the last offer can counter it.

## Roles

| Role | Who |
|------|-----|
| Offerer | whoever made the outstanding offer |
| Responder | the other party — the one whose turn it is |

Roles swap with each counter.

## Sequence

1. **Responder** sees an offer waiting, marked as needing their attention, with what it would
   commit them to.
2. **Responder** sees what differs from the last thing they saw — their limit, the other party's
   limit, notice periods.
3. **Responder** changes what they want changed and sends it back. They are told this replaces their
   agreement with a new proposal that the other side must now accept.
4. **Offerer** is notified that the offer came back changed, and sees what changed.
5. Repeat until one of them accepts the other's offer unchanged.
6. When both have signed the same offer, the tally is open on those terms.
   → [04](04-first-look-at-an-open-tally.md)

### Alternative A: two offers get signed at once
3.1. The responder counters while the other party is accepting the previous offer, so both offers
     end up signed by both parties.
3.2. The later-drafted offer governs. Both parties see the same outcome, and both are shown which
     offer took effect and which was superseded.
3.3. Either party may propose again from there, or close the tally if the outcome is unwanted.

### Alternative B: it goes stale
4.1. Nobody responds and the offer expires.
4.2. The tally shows as expired and stops asking for attention. Either party may offer again.

### Alternative C: changing terms of an open tally
1.1. A party proposes new terms on a tally already open.
1.2. The tally keeps trading on the existing terms while the proposal is pending.
1.3. On agreement, the new terms take effect and both parties see when they did.
1.4. The unit of account is not offered as changeable.

### Alternative D: raising or lowering my own limit
1.1. A party changes only its own limit — what it is willing to be owed.
1.2. This needs no agreement from the other side; it is that party's decision alone.
1.3. The other party is notified. A reduction takes effect after the notice period the terms
     specify; an increase can take effect at once.

## Acceptance Criteria

**Both parties**
- [ ] The party whose turn it is sees the tally in their attention list; the waiting party does not
- [ ] Each offer shows what changed from the previous one
- [ ] Countering is presented as replacing agreement, not amending in place
- [ ] The terms in force are always visible and distinguishable from the terms proposed
- [ ] When an offer is accepted, both parties see the same terms took effect
- [ ] If two offers are both fully signed, both parties see the later-drafted one in force, and are
      shown which offer was superseded
- [ ] Expired offers stop requesting attention and can be re-proposed
- [ ] Changing one's own limit alone requires no counter-signature and notifies the other party
- [ ] A reduction states when it takes effect; an increase applies immediately
- [ ] The unit of account is never presented as negotiable after the first agreement

## Variants
- happy: one counter, then agreement
- empty: no pending offer — nothing to negotiate
- error: superseded-offer race; offer expires mid-negotiation
