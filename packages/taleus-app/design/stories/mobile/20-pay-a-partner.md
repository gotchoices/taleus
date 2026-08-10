# User Story: Pay a partner

## Story Overview

I want to hand value to someone I hold a tally with — because I am buying something, or because I am
settling up — and have both of us end up with the same record of it.

Context: Sam has tallies with Jan and with Mara's bike shop. He is about to buy a tube from Mara, and
separately wants to clear the $180 he still owes Jan from the bike.

## Roles

| Role | Who |
|------|-----|
| Giver | the party handing over value — the one who records and signs it |
| Receiver | the counterparty |

Either party can be either role at any time. Recording value is always the giver's act.

## Sequence

1. Sam buys a $40 tube from Mara. He records that he owes her $40, on their tally.
2. He is shown what it does to where they stand before he commits: he owes $40 more, and he has that
   much less room left of what Mara lets him owe.
3. He can attach something to say what it is for — enough that either of them will recognise it in a
   year.
4. He signs it. This is his own act; Mara does not have to agree to receive value.
5. Both of them see the balance move, and both see the same record of why.
6. Later, Sam hands Jan $180 in cash for the bike. Cash is outside Taleus, so the tally does not know
   about it until someone says so.
7. Jan records having received it, which reduces what Sam owes him. Jan signs that, because Jan is
   the one giving something up — his claim on Sam.
8. Sam sees his debt to Jan fall to zero. Neither of them had to ask the other's permission at any
   point; each recorded what they themselves gave.

### Alternative Path A: Sam pledges past his limit
1.1. The tube would take Sam past what Mara agreed to be owed.
1.2. He is warned before he signs: how far past it goes, and that Mara is under no obligation to
     treat it as payment.
1.3. He can still do it. A pledge is his own promise to pay, and refusing to let him make it protects
     nobody — Mara has given up nothing by holding it.
1.4. Mara is warned too, at the moment it matters to her: this pledge is beyond what she agreed to
     extend, and handing over the tube is her call.
1.5. Neither of them treats the limit as a wall. It says what Mara agreed to; it does not say what
     Sam is able to promise.

### Alternative Path B: paying with value someone owes me
6.1. Instead of cash, Sam wants to settle with Jan using value that Mara owes him.
6.2. That is not something either of them can do directly on this tally — it needs the value moved
     through the people between them. → [30](30-pay-through-the-network.md)

### Alternative Path C: a mistake
5.1. Sam records $400 instead of $40.
5.2. Nothing can be unsaid — the record stands, and the app does not pretend otherwise.
5.3. What he can do is ask Mara for the $360 back. That is a request she answers, not something Sam
     can take. → [21](21-ask-to-be-paid.md)
5.4. Both entries stay visible afterward. A ledger shows what happened, including the parts nobody
     is proud of.

### Alternative Path D: the counterparty is unreachable
4.1. Mara's phone is off when Sam signs.
4.2. Sam is told plainly whether his entry is recorded. Standing at a counter, "did that go through"
     is the only question he has, and he gets a straight answer to it.
4.3. He is never asked to sign the same thing twice, and never left unsure whether he just paid once
     or twice.

### Alternative Path E: giving without being owed anything
1.1. Sam simply wants to give Jan $50 for a birthday.
1.2. He can. Recording value he is giving needs no invoice, no request, and no reason.

## Acceptance Criteria

- [ ] A party can record value they are giving, at any time, without the counterparty's agreement
- [ ] The effect on the balance and on remaining room is shown before the entry is signed
- [ ] Every entry is signed by the party giving the value, in the moment
- [ ] A note can be attached that makes the entry recognisable later
- [ ] Receiving outside value is recorded by the party who received it, reducing what they are owed
- [ ] An entry beyond what the counterparty agreed to be owed is warned about, not refused, and the
      party may proceed
- [ ] The receiving party is warned when a pledge exceeds what they extended, before they act on it
- [ ] Entries cannot be edited or removed; a correction is a further entry, and both remain visible
- [ ] Whether an entry is recorded is stated plainly, never ambiguously, and never requires re-signing
- [ ] Both parties end up seeing the same entry, amount, and reason

## Variants
- happy: a purchase, and a settlement
- empty: a tally with no entries yet — the first one
- error: pledge beyond the limit; counterparty unreachable; a mistaken amount

## Open

Whether an entry can be recorded at all while the counterparty is unreachable is an engine question,
not a presentation choice — the tally is one shared record. The answer changes path D materially: a
party who can record and converge later needs different words than one who cannot record at all.
Raised on the `feat-engine-tally-api` ticket.
