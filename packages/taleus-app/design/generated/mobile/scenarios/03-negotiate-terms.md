# Scenario: Negotiating terms

Source: [03-negotiate-terms.md](../../../stories/mobile/03-negotiate-terms.md)

The terms offered are not quite the ones this party wants. Neither side is privileged — whoever holds
the last offer can answer it, and the roles swap with every counter.

## Step 1: What changed, before the terms themselves

The first thing on screen is the difference from the offer before it: the notice period, nothing
else. A screen showing only the new terms would leave the reader to diff two offers in their head,
which is exactly the work this removes.

Below that are the proposed terms in both directions, and a line saying there are no terms in force
yet — this tally does not exist until both sign the same offer. On a tally that is already open the
same place says the opposite: the tally keeps working on the existing terms while an offer is
pending, so nothing is in limbo.

The unit is shown and stated as not negotiable. It is fixed for the life of the tally and is never
offered as a choice again.

![Terms proposed](../images/review-offer.png)

## Step 2: Accept, or replace

Accepting signs the offer as it stands and both parties hold the same terms.

Countering is its own section below, and says in words what it does: this becomes a *new* offer, and
the other party has to agree to it before anything is settled. That framing is the story's, and it
matters — a proposal is identified, ordered and carries an expiry, and more than one can be
outstanding at once. Editable fields with a Save button would have implied terms are a mutable thing
one party adjusts.

The counter fields start empty with the current values as placeholders, so typing nothing proposes
nothing changed.

## Alternate: both offers get signed

A counter and an acceptance of the earlier offer can cross in flight — and both end up fully signed.
The **later-drafted** offer is the one in force, and both parties see the same answer. Precedence
follows the proposal's own version order, not the order signatures arrived, so neither party needs a
clock to agree with the other.

The screen names both, marks which took effect and which was superseded, and says either may propose
again from here — or close the tally, since nobody is trapped by the outcome.

![Two offers signed](../images/review-offer-superseded.png)

## What this closes

`Attention`'s "Rae Whitfield proposed terms" item has named `ReviewOffer` since that screen was
built, and has been falling back to the tally view. It now reaches what it names.
`ReviewInvitation` no longer has to say that countering is unbuilt.

## Not shown

Three of this story's paths are about a tally that is already open: asking for terms only the other
party can grant (path C — a request, not a proposal, because only they can decide what they are
willing to be owed), changing one's own limit unilaterally with a restrictive change taking effect
only after the notice already owed (path D), and calling a balance in with a deadline derived from
the agreed notice (path E). All three belong to `TallyTerms`, `TradingSettings` and `CloseTally`,
none of which are sliced.

Path B — an offer going stale — needs an expiry the app watches rather than a fixture timestamp.
