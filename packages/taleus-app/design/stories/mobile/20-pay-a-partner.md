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
4.1. Nothing of Mara's is reachable when Sam signs. The entry is saved on his phone and goes to her
     side when it can.
4.2. Sam's screen says where it stands: waiting to send, or recorded on his side and not yet on
     hers. Once she holds it, it says nothing more. Asked "did that go through", it gives the
     straight answer.
4.3. Mara trusts her own screen. She hands over the tube when the entry shows on her side, not on the
     strength of what Sam's phone says.
4.4. If it is refused after all, Sam is told what was not recorded, and why, until he has seen it.
     Trying again cannot record it twice.
4.5. A shop that needs entries to land while a customer waits keeps something of its own always on.
     → [14](14-my-cadre.md)

### Alternative Path F: paying down what she owes him
1.1. Mara already owes Sam $200 from a job he did for her.
1.2. His $40 tube does not put him in debt to her — it comes off what she owes, leaving $160.
1.3. Nothing about the act differs: he records value he is giving, and the balance moves. Which side
     of zero it lands on is arithmetic, not a different kind of transaction.

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
- [ ] Whether an entry is recorded is stated plainly, never ambiguously
- [ ] An entry not yet with the counterparty says so on the giver's side, until it is
- [ ] The receiver acts on what their own side shows, never on the giver's screen
- [ ] An entry that is refused says so until seen, leaves nothing half-done, and can be retried
      without risk of recording twice
- [ ] Both parties end up seeing the same entry, amount, and reason

## Variants
- happy: a purchase, and a settlement
- empty: a tally with no entries yet — the first one
- error: pledge beyond the limit; counterparty unreachable; a mistaken amount

## Open

How long an entry may wait unsent, and when the giver is told it has not reached the other side,
depends on how many machines each party runs. The rule the screens hold either way: the giver sees
where their entry stands, and the receiver trusts their own side.
