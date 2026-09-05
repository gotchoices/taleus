# User Story: My records in my books

**Stub — not yet written.** See [index.md](index.md).

## Topic
Getting what happened on my tallies into whatever I keep my books in — an accountant's file, a
spreadsheet, or a bookkeeping app I already run.

The interesting case is the last one. [Bonum](https://github.com/gotchoices/bonum) is double-entry
accounting on the same platform: tallies are assets and liabilities, chits are transactions, and for
a party running both, the two sets of records describe the same events on the same devices. What the
party wants from that is simply not to type anything twice, and not to end up with two versions of
the truth.

How applications on this platform share data with each other is still being worked out, so this story
should stay vague about mechanism and specific about outcome. Something better than a file is
plausible; nothing is promised.


## Baseline not to regress
MyCHIPs had no accounting integration. Health's `06-imp-exp` story is the nearest sibling precedent
for getting data out.

## Open

Two accounting questions this story will have to answer, raised in review and not yet settled:

- **Do requests belong in the books as invoices?** In Taleus a request is not a ledger item — the
  balance is only what has been signed ([24](24-tally-history.md)). Bookkeeping may still want the
  outstanding ones as receivables and payables, which means deciding how something unsigned crosses
  into a set of books that treats it as an asset.
- **Cash basis or accrual?** The two questions are the same question: signed entries alone are close
  to cash basis; folding in what has been asked for is closer to accrual. A party's books may need
  either, and the answer decides what this story hands over.

Whether this is one story (get my data out) or two (a file for someone else; a live relationship with
my own books). What a tally even is in double-entry terms — one account per counterparty, or
something else; that likely needs agreeing with whoever designs Bonum's schema rather than deciding
here. And whatever sharing turns out to be possible, it carries a privacy question this story will
have to answer: a party's books may span counterparties who should not learn about each other.

Deferred until the platform story and Bonum are both further along; written here so the intent is not
lost.
