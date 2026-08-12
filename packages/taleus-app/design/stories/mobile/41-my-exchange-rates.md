# User Story: My exchange rates

## Story Overview

My tallies are not all in the same unit. I want to say what those units are worth to me, so my
holdings can be compared, and so value can move between them when I want it to.

Context: Jan holds mostly dollar tallies, three denominated in Goldbacks (gold-backed notes whose
dollar value moves with the gold market), and one in CHIPs. Until now the Goldback tallies have sat
apart from everything else — not counted in his overall position, and unable to help him pay anyone.

## Roles

Any party holding tallies in more than one unit. These rates are private to that party: no
counterparty sees them, and nobody else's rates are ever applied to this party's holdings.

## Sequence

1. Jan is shown that his Goldback tallies sit outside everything else, and why: he has never said
   what a Goldback is worth to him.
2. He says what it is worth in dollars.
3. He is told what that now permits: those holdings count toward his overall estimate
   ([40](40-my-position.md)), and value can move between his dollar tallies and his Goldback tallies
   when a payment needs it to ([30](30-pay-through-the-network.md)).
4. He is also told the scope of what he just did: this is what a Goldback is worth **to him**, on
   every tally he holds in Goldbacks. It is not a per-partner judgment. If he needs to value
   something differently depending on who he is dealing with, that is a different unit, not a
   different rate.
5. He is asked whether it works the same in both directions. It does not: he will take Goldbacks at
   his stated rate, but parting with them costs him a little more, because he would rather keep them.
   That difference is his own reluctance, not a fee anyone charges him.
6. He is warned about the thing that will actually hurt him: a fixed number goes stale. Gold moves,
   his rate does not, and anyone paying attention can take the difference off him.
7. So he is offered the alternative — follow a published source, plus or minus his own margin —
   rather than a number he must remember to maintain. He chooses that for Goldbacks.
8. He signs it, as with anything governing movement that happens without him being asked
   ([31](31-trading-variables.md)). What he signed is the instruction, not each day's number.
9. Later he can see what his rates are doing: what has been converted, in which direction, at what
   rate, and where that rate came from.

### Alternative Path A: Jan sets nothing
1.1. Most parties never come here, because most parties hold everything in one unit.
1.2. Nothing is broken. Their tallies settle within their own unit, and their position needs no
     estimating.

### Alternative Path B: a fixed rate left alone
1.1. Jan sets a flat number for CHIPs and does not look at it again for two years.
1.2. He is reminded that a stale rate is a live instruction, not a dormant preference — value is
     still moving at it.
1.3. The reminder is about his own neglect, not about a market Taleus is watching on his behalf.
1.4. Updating is a signed change, like setting it in the first place.

### Alternative Path C: what a rate is not
2.1. Jan wonders whether the app will simply tell him what a Goldback is worth.
2.2. Taleus itself has no opinion. A rate is his own valuation, which is why two parties can value
     identical holdings differently and both be right.
2.3. Where a unit has a public market, he may point his rate at a source he trusts. That is still his
     decision — he chose the source and the margin, and he can change both.

### Alternative Path G: becoming an exchange without meaning to
1.1. Jan prices Goldbacks and thinks of it as a display preference.
1.2. It is not. His rate is the price at which value will actually convert through him, and it stands
     until he changes it. Nobody sees the number, but anyone trading against him discovers it.
1.3. He is told what that makes him: the person taking the other side of every conversion at his
     price, against people who may be watching the gold market far more closely than he is.
1.4. He is shown how to limit that rather than only how to set it — a margin wide enough to be safe,
     a ceiling on how much can accumulate this way ([31](31-trading-variables.md)), or simply not
     pricing a unit he does not want to trade in.
1.5. Pricing a unit for his own figures, without permitting movement across it, remains available and
     carries none of this risk.

### Alternative Path F: a unit only he and one partner use
1.1. Jan and Dave keep a tally denominated in Dave's hours.
1.2. A flat number is fine here, and needs no source: nobody else uses this unit, so value priced in
     it only ever moves between Jan and Dave.
1.3. That is what makes it different from Goldbacks or CHIPs — units many people hold are the ones
     where a stale rate is expensive.
1.4. The same holds for a unit a group of friends invent for themselves: everyone in the circle
     agrees what an hour of help is worth, nobody outside uses it, and there is nobody to arbitrage
     against. This is the safe and interesting case, not a lesser one.

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
- [ ] A rate applies to every tally the party holds in that pair of units; per-partner valuation is
      not a rate but a different unit
- [ ] Rates are private to the party and never disclosed to a counterparty
- [ ] Rates may differ by direction, and the party is asked about both
- [ ] The party is told what setting a rate enables: inclusion in their position, and movement
      between units
- [ ] Rates are signed, like anything else governing movement that happens without asking
- [ ] Valuing a unit for display and permitting automated movement across it are separable decisions
- [ ] A party is never shown a rate presented as a market or true value
- [ ] A rate may follow a published source, plus or minus the party's own margin, rather than being
      a fixed number
- [ ] The party chooses the source and the margin; the app never picks one for them
- [ ] Pricing a widely-traded unit is presented as taking a market position, not as a display setting
- [ ] The party is shown how to limit exposure — margin, ceiling, or not pricing the unit — alongside
      how to set a rate
- [ ] A unit used only within a small circle is presented as the low-risk case it is
- [ ] What the party signs when following a source is the instruction, not each day's figure
- [ ] A stale fixed rate is surfaced as a live instruction the party may want to revisit
- [ ] The party can see where a rate came from when reviewing what was converted
- [ ] A party who sets no rates is fully functional within a single unit
- [ ] Holdings in unpriced units remain usable within their own unit

## Variants
- happy: Goldbacks priced against a source, folded into position, available for movement
- empty: a party holding one unit — nothing to price
- error: a stale fixed rate; a source that cannot be reached; a unit the party cannot price at all;
  a party quietly taking on market risk they did not intend

## Open

Following a published source raises a question the engine has to answer: who signs each day's figure,
and how. Signing the *instruction* once and letting the party's own node apply it is the natural
reading, and it matches how trading settings work — but it is the same class of standing authority
and deserves the same scrutiny. Raised on `feat-position-and-estimates`.
