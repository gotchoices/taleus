# Rules

App-facing rules of play. Engine semantics live in `docs/architecture.md`; this file states only
what the apps must get right.

## Amounts

Each tally is denominated in one unit, fixed for its life. A party holds tallies in different units,
and no unit is privileged — there is no single party-level balance.

A party may pick a display unit. Cross-unit figures are estimates at the party's own rates, shown as
estimates, never replacing the per-unit figures.

## Credit

Two limits per tally, one per direction, each set by the party being asked to trust. They need not
match and either may be zero. Zero credit is not a closed tally.

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
