# User Story: My profile and what I disclose

## Story Overview

Different people need to know different things about me. I want to decide, for each person I tally
with, what they get — and to be able to tell them more later without starting over.

Context: Sam has been trading with Jan for a few months on nothing more than a name and phone
number. He is about to open a tally with a supplier who wants more, and one with Mara's bike shop
who needs almost nothing.

## Roles

Any party. What another party learns about them is only ever what they chose to send.

## Sequence

1. Sam looks at what he has told people about himself. It is not much: a name and a phone number,
   given to Jan back at lunch.
2. He fills in more — an address, and the name of his business — because he expects to need it. None
   of it goes anywhere yet; adding something to his own record does not send it to anybody.
3. He opens a tally with a supplier. He is asked what to include for *this* party, and can see what
   he has available.
4. The supplier's invitation says it expects a business name and address. Sam includes those.
5. He tallies with Mara's shop the same week and includes only his name — a shop needs no more.
6. Later, Sam can see what he sent to whom: Jan has his name and phone, the supplier has his address
   and business name, Mara has a name.
7. Jan's business grows and he asks Sam for an address. Sam adds it to their existing tally — no new
   tally, no renegotiated terms, just more disclosed than before.

### Alternative Path A: someone wants more than Sam will give
4.1. The supplier expects a tax identifier. Sam is not willing.
4.2. He can proceed without it. The supplier is free to decline to countersign — that is their
     answer, and Sam is not forced either way.
4.3. Sam is not told his information was "rejected"; he is told the tally is not agreed.

### Alternative Path B: Mara's shop discloses to everyone
3.1. Mara publishes a standing invitation ([01](01-invite-a-partner.md), path C).
3.2. Whatever she includes goes to every customer who takes it up. She is told this before she
     publishes: this disclosure is effectively public.

### Alternative Path C: correcting something
1.1. Sam changes his phone number, and wants the people who have the old one to have the new one.
1.2. He is shown which of his tallies carry the old number, and asked to authorize the correction —
     each one is a statement he signs, so the app does not send any of them on his behalf. He
     authorizes once, for the set he chooses.
1.3. If he authorizes none, nothing is sent, and his own record still shows the new number.
1.4. What he corrected and when remains visible to both sides; a correction is a new statement, not
     an erasure of the old one.

### Alternative Path D: what Sam sees of others
1.1. Sam looks at what Jan has disclosed to him.
1.2. He can see it is what Jan says about himself, not something Taleus has verified.
1.3. He can tell what Jan chose not to send from what Jan does not have.

## Acceptance Criteria

- [ ] A party maintains their own information without any of it being disclosed by that act
- [ ] Disclosure is chosen per counterparty, from what the party has available
- [ ] A party can see what they have disclosed to each counterparty, after the fact
- [ ] A party can disclose more on an existing tally without renegotiating terms
- [ ] An inviter can state what they expect to be disclosed; the invitee may decline and proceed
- [ ] Withholding is not framed as failure — the counterparty simply need not agree
- [ ] A correction is sent only to the counterparties the party authorizes, never automatically
- [ ] A standing invitation's disclosure is presented as public before it is published
- [ ] What a counterparty discloses is presented as their claim, not as verified fact
- [ ] What a counterparty withheld is distinguishable from what they do not have

## Variants
- happy: different disclosure for three different counterparties
- empty: a party who has disclosed only a name, to one person
- error: a correction that cannot be delivered to a counterparty right now
