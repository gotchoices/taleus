# Rules

App-facing rules of play. Engine semantics live in `docs/architecture.md`; this file states only
what the apps must get right.

## Amounts

Each tally is denominated in one unit, fixed for its life. A party holds tallies in different units,
and no unit is privileged — there is no single party-level balance.

A party may pick a display unit. Cross-unit figures are estimates at the party's own rates, shown as
estimates, never replacing the per-unit figures.

Value does not move between units a party has not priced. Until they say what one unit is worth to
them, their tallies in different units settle separately — nobody else's valuation is applied to
their holdings on their behalf.

Pricing a unit others trade widely is a market position, not a display choice: the party's rate is
what value converts at until they change it, against counterparties who may follow that market far
more closely. Treat it as a decision with exposure, and say so.

## Credit

Two limits per tally, one per direction, each set by the party being asked to trust. They need not
match and either may be zero. Zero credit is not a closed tally.

A limit says what a party agreed to be owed. It does not stop the other party pledging more: a
pledge is the pledger's own promise, and the party holding it has given up nothing. Both sides are
warned when a pledge goes beyond the limit — the one making it, and the one deciding whether to
hand over goods for it. Lifts are a different matter: those stay inside the limits.

## Signing

Two kinds of act, and the app has to keep them apart:

- **The party signs it, then and there.** Terms, offers and acceptances, manual payments,
  disclosures, close requests, corrections, and changes to the party's own lift settings. Nothing of
  this kind happens on a party's behalf or as a side effect of something else.
- **The party authorized it earlier.** Lifts. A party's signed lift settings say how much movement it
  will accept and at what price; lifts then happen within those settings without prompting, including
  while the party is asleep.

So the app never asks a party to approve a lift, and never fails to ask before anything else. What a
party's settings currently permit is something they can see and change; changing them is itself an
act they sign.

## Offers

- An offer is not an agreement until both parties sign it.
- More than one offer may be outstanding; any unexpired one may be accepted.
- If two end up signed by both parties, the later-drafted one governs.
- Offers expire. Expiry is the only thing that ends one.
- Declining is private — the other party sees only silence.
- Exit is by close, not by retraction.
