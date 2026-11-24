description: Before lifts can cross between currencies, a person needs to decide a few rules: who gets to see each converter's exchange rate, what a currency-crossing loop means, and how hard the network should look for such routes.
files: docs/architecture.md, docs/denominations.md, packages/tallynet/docs/design.md, packages/taleus-core/src/lift/discovery.ts, packages/taleus-core/src/lift/terms.ts
----

**Category (a), a human decision.** Unblocks when each question below has an answer written into `docs/architecture.md` § Denominations and Exchange (or `packages/tallynet/docs/design.md`) and this file is deleted. `tallynet-multi-denomination` waits on it.

Background: each tally has one denomination. A party holding tallies in two denominations may let lifts pass between them, converting at a rate it sets in a private exchange-rate quote. Already decided (architecture.md): payment is stated in the payee's unit; conversion is integer math rounded up; the originator absorbs the rounding; a missing quote blocks the route; amounts are fixed at commit.

## 1. Who sees a converter's rate?

Today's `taleus-core` code has each hop put its exchange-rate quote in the terms it advertises during discovery, and the originator does all the conversion math. So the originator (and anyone relaying the plan) learns every converter's rate, though architecture.md calls quotes private.

- **A (recommended):** each converter does its own conversion when the found route comes back through it, and passes on only the resulting amounts. The rate itself never leaves the node. The amounts on either side of it still let anyone who sees the signed route infer the effective rate *for that lift*.
- **B:** keep today's model (rates disclosed to the originator). Simpler; the originator can verify the whole route's math.

Reversible: moderately. It's mostly code in `taleus-core/src/lift` and TallyNet hooks, no schema change.

## 2. Should everyone on a route see the whole route?

The consensus record (as in ChipNet) carries the full route, every link and its amounts, to every participant, because each participant pushes it on and checks signatures over it. Tally ids are hidden (salted hashes), but amounts, denominations and member keys are visible to all.

- **A (recommended for v1):** accept it. It matches ChipNet/MyCHIPs, and the schema's per-edge referee signature already keeps each tally's settlement independent of the route.
- **B:** design a reduced view (each participant sees only its own links plus commitments to the rest). Substantial protocol work; would go to backlog.

## 3. What does a circular lift mean when the loop crosses currencies?

A clearing lift starts and ends at the same party. If the loop crosses denominations, the originator's outgoing and incoming tallies may be in different units, so the "lift" is also a currency exchange for the originator.

- **A (recommended):** allow it only when the originator itself holds a quote for its own boundary, treating the originator as one more converter.
- **B:** require circular lifts to stay in one denomination for v1.

## 4. How hard should discovery search for currency-crossing routes?

These routes are rarer (they need a converter with a current quote at each boundary). Options: same search depth and time budget as any lift (recommended for v1; tune later), or a larger depth/budget when the query allows conversion, or an originator flag "same denomination only" to skip them entirely (cheap to add either way).

## 5. Does a party opt in per pair of tallies, or per pair of currencies?

Recommended: holding a current quote for a currency pair *is* the opt-in, applying across all the party's tallies in those currencies (as designed in portfolio.qsql). Alternative: an extra per-tally-pair allow list. Only needed if a party wants to bridge some tallies in a currency but not others.

What happens if nothing is decided: `tallynet-multi-denomination` stays parked; single-denomination lifts (all of v1's discovery, consensus and binding work) proceed unaffected.
