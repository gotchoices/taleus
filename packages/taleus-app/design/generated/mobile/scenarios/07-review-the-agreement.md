# Scenario: Review the agreement

Source: [07-review-the-agreement.md](../../../stories/mobile/07-review-the-agreement.md)

What can each of us do, what did we sign, when did it change, and who is this person I signed it
with? Checked before committing to something larger.

## Step 1: What is in force, from this party's own side

Both directions, each labelled by who extended it, each with the date it took effect — the two sides
took effect on different days, and the screen never pretends otherwise. Jan lets Sam owe him $500
with 21 days' notice, in force since March; Sam lets Jan owe him nothing.

![Terms](../images/tally-terms.png)

## Step 2: A reduction that has not taken hold

Path B. A raise applies at once; a reduction waits out the notice period. So the figure that governs
today is the one above, and the one that will govern is stated separately with the date it starts.

## Step 3: Reductions stack on the future, not on the past

Path E. A second cut, agreed a week later, before the first has taken effect. Both are visible, each
with what it governs. And path D: $180 is outstanding, so it stays under the terms it was advanced
under — a reduction does not reach back. With nothing outstanding the screen says the opposite, that
there is no runway to shorten and it applies at once.

## Step 4: Proposed, and therefore binding on nobody

Path A. On [the tally with Mara's shop](taleus://screen/TallyTerms/tally%3Amara-shop?variant=happy),
Jan has proposed raising what he will let her owe him. It is kept out of the history, which is only
what was agreed, and the card says the thing that matters: nothing about a proposal changes what
either of them may do today.

## Step 5: How the terms got here

Every set that was ever agreed, what changed about it, who set it, when they agreed it, and when it
took effect. On [a tally neither party has amended](taleus://screen/TallyTerms/tally%3Apriya-new?variant=happy)
the opening terms are the whole history, and the screen says so rather than showing an empty card.

## Step 6: The contract the figures are arguments to

Step 5 of the story. The terms are not the agreement — they are figures filled in on a document both
parties signed. The card names the document, its publisher and version, says which figures above
filled which parameters, and prints what it says.

## Step 7: The contract cannot be fetched

The story's error case. The terms in force are this party's own record and do not depend on the
document being reachable, so they still read; the card says what failed and offers to try again.

![No contract](../images/tally-terms-no-contract.png)

## Step 8: Who they say they are

Their claim about themselves, never something Taleus checked — and what is absent stays ambiguous,
because withheld and never-written-down look identical from this side. Path C: if it matters, the row
opens what the two of them know of each other, where asking is possible.

## Not shown

Proposing a change from here — this screen reads, and nothing on it binds; that is story 03's
proposing side and is unsliced. Path F is demonstrated on a tally that has stopped trading rather
than a closed one: no fixture produces a `Closed` tally yet.
