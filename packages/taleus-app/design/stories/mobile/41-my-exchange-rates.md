# User Story: My exchange rates

## Story Overview

My tallies are not all in the same unit. I want to say what those units are worth to me, so my
holdings can be compared, and so value can move between them when I want it to.

Context: Jan holds mostly dollar tallies, two in hours of work, one in CHIPs. Until now the hours
have sat apart from everything else — not counted in his overall position, and unable to help him pay
anyone.

## Roles

Any party holding tallies in more than one unit. These rates are private to that party: no
counterparty sees them, and nobody else's rates are ever applied to this party's holdings.

## Sequence
<!--EC I'm worried that using hours as our example may be confusing.  It has that potential because a hour is so subjective.  If I _did_ have several tallies trading in hours, I would likely _value_ the "hour" differently based on who the tally was with.  I do think that "hours" is a valid choice for UoA, but it clouds some issues for our stories.  Research the Goldback at goldback.com.  It might be a good example to use in our stories to complement Dollars and CHIPs.  I think this implication is that or any given UoA, if we set a single exchange rate for it (say, to Dollars) we are willing to apply that same exchange rate to any two tallies that have those respective UoA's.  Do you agree with this? 

If we do a tally in hours, one might consider Dave-hours, John-hours, Sue-hours, etc.  BTW, the CHIP is a "nominal hour" and is meant to address this very parity issue with the literal hour.

Now, this opens some new issues:
If I declare a static exchange rate between goldbacks and dollars, I would have to be very diligent, resetting the value every day--maybe multiple times a day.  For these types of exchange rates, we will likely need to resort to a published index.  With goldbacks, for example, we may like to refer to the current market price of gold and exchange at that rate, + or - some margin.  If I don't, I will be the target of more diligent arbitrage traders and I will doubtlessly lose that battle.

Dave-hours are safe to price statically because a lift in Dave-hours is local to my tally with Dave.  It is effectively a way for Dave to spend his Dave-hours with me on other things that are priced in Dollars (for example).  But if the UoA is one that many people employ, the danger becomes more real.  A CHIP exchange rate might also resort to a published index (chipcentral.net) for example.
-->
1. Jan is shown that his hours tallies sit outside everything else, and why: he has never said what
   an hour is worth to him.
2. He says what it is worth — an hour is $50 to him.
3. He is told what that now permits: those holdings count toward his overall estimate
   ([40](40-my-position.md)), and value can move between his dollar tallies and his hours tallies
   when a payment needs it to ([30](30-pay-through-the-network.md)).
4. He is asked whether it works the same in both directions. It does not: he will happily take hours
   at $50, but giving up hours costs him more than that, because he would rather keep them.
5. He says so, and the difference is his — it is not a fee anyone charges him, it is his own
   reluctance, expressed as a number.
6. He signs the rates, as he does with anything that governs how value moves without him being asked
   ([31](31-trading-variables.md)).
7. Later he can see what his rates are doing: what has been converted, in which direction, at what
   rate.

### Alternative Path A: Jan sets nothing
1.1. Most parties never come here, because most parties hold everything in one unit.
1.2. Nothing is broken. Their tallies settle within their own unit, and their position needs no
     estimating.

### Alternative Path B: a rate that no longer reflects reality
1.1. Jan set an hour at $50 two years ago and has not looked since.
1.2. Because his rates govern real conversions, he is reminded that a stale rate is still a live
     instruction — not warned about a market moving, which is not something Taleus knows about.
1.3. Updating is a signed change, like setting it in the first place.

### Alternative Path C: what a rate is not
2.1. Jan wonders whether the app will tell him what an hour is "really" worth.
2.2. It will not, and says so. There is no market here and no oracle; a rate is his own valuation,
     which is why two parties can value the same holdings differently and both be right.

### Alternative Path D: pricing only for display
2.1. Jan wants his CHIPs counted in his overall figure but does not want value routed into or out of
     them automatically.
2.2. Valuing something and permitting movement are different decisions, and he can make them
     separately. → [31](31-trading-variables.md)

### Alternative Path E: a unit he has no opinion about
1.1. Someone offers Jan a tally denominated in something he cannot price at all.
1.2. He can hold it. It stays in its own unit, outside his estimate, and outside any automated
     movement — which is a coherent state, not a broken one.

## Acceptance Criteria

- [ ] A party can say what one unit is worth to them in another
- [ ] Rates are private to the party and never disclosed to a counterparty
- [ ] Rates may differ by direction, and the party is asked about both
- [ ] The party is told what setting a rate enables: inclusion in their position, and movement
      between units
- [ ] Rates are signed, like anything else governing movement that happens without asking
- [ ] Valuing a unit for display and permitting automated movement across it are separable decisions
- [ ] A party is never shown a rate presented as a market or true value
- [ ] A stale rate is surfaced as a live instruction the party may want to revisit
- [ ] A party who sets no rates is fully functional within a single unit
- [ ] Holdings in unpriced units remain usable within their own unit

## Variants
- happy: hours priced, folded into position, available for movement
- empty: a party holding one unit — nothing to price
- error: a stale rate; a unit the party cannot price at all
