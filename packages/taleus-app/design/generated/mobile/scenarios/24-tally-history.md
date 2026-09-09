# Scenario: Tally history

Source: [24-tally-history.md](../../../stories/mobile/24-tally-history.md)

What has actually happened between two parties, and what is still being asked. Sam is checking before
paying Mara again.

## Step 1: Following the balance back

Entries most recent first, each with how much, which way it went, when, and what it was for. Every
entry carries the balance that resulted **stated from the reader's side**, so today's figure can be
followed rather than trusted — a bare "Balance $180.00" would put the sign back on the reader.

Direction is never carried by colour alone: the word, a sign, and the colour all say it, so nothing
is lost to a greyscale screen or a red-green deficiency.

![History](../images/tally-history-happy.png)

## Step 2: What is still being asked, beside the ledger

Outstanding requests sit alongside the entries and never among them, each saying which way it runs.
What Sam *owes* is what he has signed; what Mara is *asking* is her statement of what she thinks he
owes. Both are worth seeing; only one moves the balance.

## Step 3: An entry recognisably tied to the request it answered

The `$70.00` toward Mara's brake service, marked as having answered a request, with `$25.00` still
outstanding above it. Story 24 step 6 is the difference between "money moved that day" and "this paid
that bill".

![An answered request](../images/tally-history-answered.png)

## Step 4: A tally with no history

Normal, not an error.

![Nothing yet](../images/tally-history-empty.png)

## Not shown

Narrowing by period, size, amount or purpose (path B); the running balance as a curve; an unfinished
routed payment with its prospective effect (path A) — no fixture has ever carried one; export for an
accountant (path E). `EntryDetail` is unsliced, so an entry cannot yet be opened.
