# User Story: Tally history

## Story Overview

I want to see what has actually happened between me and someone — every entry, what it was for, and
how we got to the balance we are at now.

Context: Sam and Mara have been trading for a year: repairs, parts, a few settlements, and some
value that moved on its own when payments routed through them. Sam is checking the tally before
paying her again.

## Roles

Either party, from their own side. Both see the same entries; each sees them in their own direction.

## Sequence

1. Sam looks at what has happened on his tally with Mara, most recent first.
2. Each entry tells him what he needs to recognise it: how much, which way it went, when, and what it
   was for.
3. He can see who put each entry there — the one who gave the value signed it, so there is never a
   question of who said what.
4. Each entry shows where the balance stood afterward, so he can follow how they arrived at today's
   figure rather than having to trust it.
5. Some entries are ones neither of them typed: value moved because a payment found its way through
   their tally. Sam can tell those apart from the ones he and Mara made deliberately.
6. He finds the $95 repair from March and can see it answered Mara's request, not just that money
   moved that day.
7. Satisfied he knows where they stand, he goes ahead. → [20](20-pay-a-partner.md)

### Alternative Path A: something still in progress
1.1. A payment routing through this tally has not finished.
1.2. Sam can see it, marked as not yet settled, and can see what the balance would be if it completes.
1.3. He is not misled into thinking it is done, nor into thinking the tally is broken because a
     figure is moving.

### Alternative Path B: a long history
1.1. Sam and Mara have hundreds of entries.
1.2. Sam can narrow to a period, or to entries above a size, or find the one he half-remembers by
     what it was for.
1.3. He can also follow the running balance over time rather than entry by entry — where it stood
     through the year, which side of zero it sat on, and whether it trends toward him or away. This
     is movement through the tally over a period, not a statement of what he is worth; that is a
     single moment across all his tallies. → [40](40-my-position.md)

### Alternative Path C: an entry Sam does not recognise
2.1. Sam finds an entry from November he has no memory of.
2.2. Everything that could help is there: the amount, the direction, the note, whether it answered a
     request, and whether it was deliberate or routed through.
2.3. If it was Mara's entry, he can see it was hers. Nothing in the history is anonymous.

### Alternative Path D: history after closing
1.1. Sam looks at a tally he closed with a supplier last year.
1.2. Everything is still there and still readable. Closing ended the trading, not the record.

### Alternative Path E: getting it into his books
1.1. Sam's accountant wants the year's entries.
1.2. Sam can get them out in a form someone else can use.
1.3. Sam also keeps his own books. Where those books live on the same devices he already trusts, the
     better answer is not a file at all — it is granting them access to what is already there.
     → [25](25-my-records-in-my-books.md)

## Acceptance Criteria

- [ ] Entries are listed most recent first, each with amount, direction, date, and stated purpose
- [ ] Each entry identifies the party who made it
- [ ] Each entry shows the balance that resulted, so the current figure can be followed back
- [ ] Entries that arose from routed payments are distinguishable from ones the parties made
- [ ] An entry that answered a request is recognisably tied to that request
- [ ] Unfinished movement is visibly unfinished, with its prospective effect shown
- [ ] Long histories can be narrowed by period, size, or purpose
- [ ] The running balance over a period is available, not only individual entries
- [ ] Movement over a period is presented as distinct from what the party is worth at a moment
- [ ] History remains complete and readable after a tally closes
- [ ] A party can get their history out in a form usable outside the app

## Variants
- happy: a year of mixed entries, direct and routed
- empty: a tally with no entries yet
- error: an entry whose counterparty details cannot be loaded; movement stuck unfinished
