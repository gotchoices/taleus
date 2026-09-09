# Scenario: First look at an open tally

Source: [04-first-look-at-an-open-tally.md](../../../stories/mobile/04-first-look-at-an-open-tally.md),
[07-review-the-agreement.md](../../../stories/mobile/07-review-the-agreement.md)

Jan and Sam have signed the same terms. This is what each of them now has, read from their own side.

## Step 1: A tally with nothing on it yet

The story's actual opening scene: a zero that is explained rather than an empty result. Terms are
readable in both directions, each labelled by who extended it, so neither party has to work out
which number belongs to whom.

![A new tally](../images/tally-view-new.png)

## Step 2: Once value has moved

The balance leads, described from the reader's side. Room to spend is its own figure and is described
as credit the other party extended — never as value held. The governing agreement is named, with who
published it and in what language (story 07).

![A tally with a balance](../images/tally-view-happy.png)

## Step 3: A unit that does not divide by ten

Dave's hours divide into sixty minutes, so the denominator is shown: `07` alone would read as seven
hundredths.

![Hours](../images/tally-view-hours.png)

## Alternates

**Path C — the counterparty is unreachable.** This is Jan's record too, so the tally and its terms
still read. What needs Sam is described as pending, not failed.

![Unreachable](../images/tally-view-unreachable.png)

**Other tallies worth opening**, registered but not photographed:

- [The other side of a balance](taleus://screen/TallyView/tally%3Amara-shop?variant=happy) — what Jan owes
- [A tally that is closing](taleus://screen/TallyView/tally%3Asupplier-parts?variant=happy)

## Not shown

Story 07's own screen (`TallyTerms` — previous terms, the full agreement text) is unsliced; only the
agreement's name and publisher appear here. Path B, asking to close, belongs to `CloseTally`. Step 7's
next actions — record, ask, change a limit — wait on the Pay and Request slices.
