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

## Offers

- An offer is not an agreement until both parties sign it.
- More than one offer may be outstanding; any unexpired one may be accepted.
- Offers expire. Expiry is the only thing that ends one.
- Declining is private — the other party sees only silence.
- Exit is by close, not by retraction.
