# User Story: Pay someone I'm not connected to

**Stub — not yet written.** See [index.md](index.md).

## Topic
Paying a person I hold no tally with, by moving value along a path of tallies — and understanding what it cost.

## Baseline not to regress
MyCHIPs: lifts, surfaced in chit history rather than as their own flow.

## Open
How much of the path to reveal, what the user sees while a lift is in flight, and what happens when
it fails.

Unlike a direct request ([21](21-ask-to-be-paid.md)), a request to someone with no tally between you
cannot travel in-band — it has to be something the payer can pick up, scan, or follow. On receiving
it the payer's side has to answer a question that has no analogue in direct payment: is there a route
to the payee at all, and does it have the capacity for this amount? In a mature network the answer is
usually yes; in a young one it is often no, and the story has to make that a comprehensible outcome
rather than a failure. Note that lifts a party *relays* need no approval from them — their signed settings already
authorized it ([31](31-trading-variables.md)) — so the story must distinguish a lift the party
initiated from one that passed through them while they slept.
