# User Story: What reaches my partner

## Story Overview

I want to know, for anything I do on a tally, whether my partner has it yet, without having to
understand the network that carries it.

Context: Mara runs a bike shop and trades with a dozen customers from her phone. Her tallies are
records she and each partner keep together. Each change travels from her side to theirs, and that
can take time, especially when a partner's phone is off.

## Roles

Either party, about their own acts: a payment, a request, a decline, a close request, a change of
terms. Their partner's acts simply appear when they arrive.

## Sequence

1. Mara records a payment to a supplier whose phone is off. It is saved on her phone at once, and
   she can carry on.
2. She notices that not everything she does lands with her partner immediately. Each thing she has
   done shows whether it is still on its way or her partner holds it. Once they hold it, it says
   nothing more; that is the normal case.
3. Where a figure includes something her partner does not hold yet, the app says how much.
4. If she wants to know why changes take time, she can read how Sereus, the platform Taleus is
   built on, carries changes between partners. She does not need to, to use the app.

### Alternative Path A: something does not go through
2.1. One of Mara's acts is refused after it left her phone. Perhaps her partner closed the tally
     before it arrived.
2.2. She is told what was not recorded, and why, and it stays in view until she has seen it.
     Nothing changed on the tally, and she can do it again.

### Alternative Path B: something that may not go through
2.1. Mara answers a customer's request with a payment while the customer is away. Something the
     customer does in the meantime could still stop it, such as withdrawing the request.
2.2. The app says it may not go through. If it does not, path A follows.

### Alternative Path C: nothing will say when it arrives
2.1. Sometimes Mara's phone cannot follow a change all the way to her partner.
2.2. The app says it is recorded on her side and not confirmed delivered. It never calls it stuck.

### Alternative Path D: her own phone is offline
2.1. Mara is on a flight. What she records is saved on her phone.
2.2. The tally says her phone is offline, so the wait is hers, not her partner's. Nothing is flagged
     for her attention: it goes when she lands.

### Alternative Path E: something is not getting through
2.1. Mara's partner's side has been reachable for a few minutes, yet a payment she made still has
     not reached them.
2.2. The app marks it "Not getting through" and lists the tally for her attention. Time her phone or
     her partner's was away does not count toward it.

## Acceptance Criteria

- [ ] Every act of the party's own shows whether the partner holds it yet, until they do
- [ ] A delivered act shows nothing further
- [ ] A figure that includes something the partner does not hold yet says how much
- [ ] A refused act is reported with its reason until the party has seen it, and can be redone
- [ ] An act that may still be refused says so while it waits
- [ ] Waiting while either side is offline is never an alarm; the tally says whose side is away
- [ ] An act unresolved for minutes while the partner's side is reachable is flagged for attention
- [ ] The party is never required to understand the network; an explanation is available to those
      who want it

## Variants
- happy: one act on its way, the rest delivered
- error: an act waiting that may fail; one refused
