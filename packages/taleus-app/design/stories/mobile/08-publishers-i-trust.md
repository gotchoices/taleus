# User Story: Publishers I trust

## Story Overview

I cannot judge a contract by reading it, any more than I can judge a software licence or a lease. What
I can judge is who stands behind it. I want to be told who published the agreement I am being asked
to sign, and whether that is someone I have decided to trust — without having to manage a list.

Context: Sam has been using Taleus for a few months. Most of his tallies are under the standard
agreements that come with the app. His bike club has started using an agreement written by
fair-n-square.org, an association that publishes plain-language trading agreements.

## Roles

| Role | Who |
|------|-----|
| Party | Sam — deciding what he will agree to |
| Publisher | sereus.org, which makes Taleus; fair-n-square.org; others he has never heard of |

## Sequence

1. Whenever Sam is shown an agreement — choosing one to offer, or deciding on one he is offered — he
   is told who published it, and whether that is a publisher he trusts. sereus.org, which makes
   Taleus, is always trusted: it comes with the app.
2. A club member invites him to tally under fair-n-square.org's agreement. Sam is told it is
   published by fair-n-square.org, which is not among the publishers he trusts.
3. Sam has heard good things about them. As he accepts, he is asked whether to trust just this
   agreement, or everything fair-n-square.org publishes for tallies. He chooses the publisher.
4. From then on, fair-n-square.org's agreements come without a warning, and are among the agreements
   he can offer others.
5. Sam never had to open a list. If he wants to, he can find it in Settings: sereus.org, built in,
   and fair-n-square.org, with when and why he added it.
6. A friend recommends another publisher. Sam types its name into the list himself.

### Alternative Path A: recommended by someone he trusts
2.1. An agreement is published by xyz.org, which Sam does not know, but sereus.org recommends it.
2.2. He is told exactly that: published by xyz.org, which he does not trust, and recommended by
     sereus.org, which he does.
2.3. The recommendation does not make xyz.org trusted. He decides, as with any other agreement.

### Alternative Path B: a claim that does not hold
2.1. An agreement says it is published by sereus.org, but sereus.org does not list it as its own.
2.2. Sam is warned more strongly than for an unknown publisher: this agreement claims a publisher
     that does not stand behind it. That sereus.org is trusted counts for nothing here.
2.3. He can still read it and decide. Nothing he does with it makes anyone trusted.

### Alternative Path C: a name that looks familiar
2.1. An agreement is published by sereus-org.com.
2.2. The publisher's name is shown in full, the same way every time, and it is not sereus.org. It is
     not trusted, and Sam is not invited to read it as if it were.

### Alternative Path D: a publisher changes its mind
1.1. fair-n-square.org stops recommending one of its agreements, or publishes a newer version of it.
1.2. When that agreement is offered, Sam is told: no longer recommended by its publisher, or replaced
     by a newer version. He decides.
1.3. Tallies already running under it are unaffected. What Sam agreed to stays agreed; what the
     publisher says now is information, not a change to the tally.

### Alternative Path E: removing a publisher
5.1. Sam falls out with fair-n-square.org and removes it from his list.
5.2. His tallies under its agreements carry on unchanged. He is simply told, from then on, that it
     is not a publisher he trusts, and its agreements are no longer offered.
5.3. sereus.org cannot be removed.

### Alternative Path F: no connection
1.1. Sam is offline when an invitation arrives.
1.2. Whether its publisher stands behind it cannot be checked right now, and he is told so rather
     than told it is fine. It is checked when he is back online.

## Acceptance Criteria

- [ ] Every agreement shown names its publisher, and whether the party trusts that publisher
- [ ] sereus.org is trusted from the start and cannot be removed
- [ ] On accepting an agreement from a publisher not trusted, the party can trust that agreement only,
      the publisher, or neither — and accepting does not require trusting
- [ ] Trusting a publisher makes its agreements offerable and stops warnings about them
- [ ] The trusted list is kept for the party; it can also be viewed, added to by hand, and pruned
- [ ] A recommendation by a trusted publisher is shown as such, and does not make the author trusted
- [ ] An agreement whose claimed publisher does not stand behind it is warned about more strongly
      than an unknown one, whatever the trusted list says
- [ ] A publisher's name is always shown in full; a look-alike is never treated as the original
- [ ] An agreement its publisher no longer recommends, or has replaced, says so when offered
- [ ] Removing a publisher changes what the party is told from then on, never a tally already agreed
- [ ] When the publisher cannot be checked, the party is told so, not reassured

## Variants
- happy: an agreement from a trusted publisher; one from a new publisher, trusted on accepting
- empty: only sereus.org in the list
- error: a claimed publisher that does not stand behind it; offline, cannot check
