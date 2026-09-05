# User Story: Pay someone I'm not connected to

## Story Overview

I want to pay someone I have no tally with. I want to know whether that is possible before I promise
anything, what it will cost me, and — when it is done — that it is actually done.

Context: Sam owes a supplier $300 for parts. He has no tally with them. He does hold credit with
Mara, who deals with people the supplier deals with. None of that is Sam's problem to work out.

## Roles

| Role | Who |
|------|-----|
| Payer | Sam |
| Payee | the supplier — no tally with Sam |
| Everyone between | people whose tallies the value moves along, who are not consulted |

## Sequence

1. Sam cannot look the supplier up — there is no directory to look anybody up in, and nobody is
   findable unless they choose to be. What he has is what the supplier gave him: a payment request
   the supplier produced and sent, which carries everything needed to try to reach them.
2. Before he commits to anything, he is told whether it can be done — whether value can reach the
   supplier at all, and whether enough of it can.
3. It can, and it costs him the $300. Moving value this way is usually free — it settles balances
   people wanted settled anyway. Where it is not free, Sam sees one number for what he gives up, not
   a breakdown of who charged what.
<!--EC NTA: Note that the indication that "it can" is only true at the moment of the query, and may not be true when and if Sam decides to proceed. -->
4. He agrees to it. This is his payment and his promise, so he authorizes it in the moment, the same
   as any value he gives ([20](20-pay-a-partner.md)).
5. It either happens completely or not at all. There is no state where Sam has paid part of it, or
   where value has left him but not reached the supplier.
6. Sam sees what changed on his side: he owes Mara more, or holds less of what she owed him.
7. The supplier sees value arrive from the person they are connected to, not from Sam — and Sam is
   told that is how it works, so he is not surprised to be invisible at the far end.
<!--EC NTA: This should also be tracked against an instrument for the supplier, no? 

KB: I'm not sure what NTA's point is here.  Do you understand?  I think the point is, the supplier gets a pledge/chit from his partner.  That way, he can buy more stuf from that partner on the resulting credit.
-->

### Alternative Path A: there is no way through
2.1. Nobody Sam is connected to leads to the supplier — an ordinary outcome in a young network, not
     a fault.
2.2. He is told so plainly, and told what would change it.
2.3. Where it can be worked out, he is shown *who* would change it: "this would be possible if you
     had a tally with any of these" — a handful of well-connected parties, rather than leaving him to
     guess who to go and meet.
<!--EC NTA: I don't think this is viable as it would require disclosure of parties.  At most it could only be done for the supplier's direct connections.  This seems like something the supplier will want to divulge, in general, however.  The obvious "connect-alls" would be financial institutions, and people are likely to already know that.  In practice, probably any financial institution will lead to all financial institutions.  

KB: Here is a wording I think NTA will agree to:  Either he is told that the deal just can't be done or, if enough information was given by the supplier in the payment request, he _might_ be able to see some possible, publicly known, partners that, if Sam were connected to, he would be more likely to be able to complete the transaction.  This is a contemplated feature of tally-net (I think) but, of course, not much of anything is currently implemented.
-->
2.4. Tallying with the supplier directly is often the answer, and it is not shaped like his tally
     with Jan: a supplier extends a newcomer nothing. Trust runs the other way, so Sam funds the
     tally — with outside money, or by directing value into it over time
     ([31](31-trading-variables.md)) — and pays from there. → [21](21-ask-to-be-paid.md) path A
2.5. He can also settle outside the app entirely and record it ([20](20-pay-a-partner.md)).

### Alternative Path B: a way through, but not enough of it
2.1. Value can reach the supplier, but only $180 of it.
2.2. Sam is told the amount that is possible rather than a bare refusal, and can decide what to do
     with that.

### Alternative Path C: it costs more than Sam will pay
3.1. This payment pushes value in a direction people along the way would rather it did not go, so
     someone is charging to allow it: $300 reaching the supplier costs Sam $327.
3.2. He sees that before agreeing and can decline. Nothing has moved and nothing is owed.
3.3. This is the exception rather than the rule — a payment running with the grain costs nothing.

### Alternative Path D: it does not complete
5.1. Something goes wrong partway — somebody is unreachable, or too slow.
5.2. Nothing moved. Sam is told it did not happen, not that it might have.
5.3. He can try again. What he is given is what is known — that no route was found at all, or that
     it was found and somebody along it did not follow through — rather than a prediction about
     whether trying again will work.

### Alternative Path E: crossing units
1.1. Sam's tallies are in dollars; the supplier deals in CHIPs.
1.2. He is told what the supplier will receive and what it costs him, in his own unit.
1.3. The rate used is visible, and is his own valuation rather than a market price
     ([41](41-my-exchange-rates.md)).

### Alternative Path F: value passing through Sam
1.1. Overnight, value moves along one of Sam's tallies because someone else was paying someone else.
1.2. Sam is not asked and is not interrupted. His settings already allowed it
     ([31](31-trading-variables.md)).
1.3. He sees it afterward in his history, marked as something that passed through rather than
     something he did. → [24](24-tally-history.md)
1.4. His net worth is unchanged by it. He holds the same total as before; it now sits on different
     tallies than it did.
<!--EC NTA: Not necessarily.  His net worth might be shifted... Sally dollars might be worth more than Jim dollars, or CHIPs might be discounted relative to dollars as he's trying to convert.

KB: I understand NTA's point here, but disagree with it. "net worth" in this context _nominal_ value--the only thing we can measure.  If the tallies use the same UoA, they _are_ the same nominal value.  The "collectability" of that debt from Sally vs Jim is a orthoginal issue.  I would probably strike his EC or, if anything, note that Sam might "prefer" one tally or another but he determines that by how he sets his trading variables.  If value disappeared from one tally and reappeared on another, due to a lift, we should presume that his position improved.  He moved a less desirable credit to a more desirable debtor.  That's why he had the trading variables set the way he did.
-->

## Acceptance Criteria

- [ ] A party can pay someone they hold no tally with, starting from something that party issued —
      there is no directory and nobody is findable without choosing to be
- [ ] Feasibility is established before the party commits to anything
- [ ] The total cost to the payer is shown before agreeing, in the payer's own unit
- [ ] The payer authorizes the payment explicitly, as with any value they give
- [ ] A payment either completes in full or does not happen; no partial outcome exists
- [ ] When no route exists, the party is told plainly and offered what would change it, including
      who they might tally with to make it possible
- [ ] When only part of the amount is possible, the possible amount is stated
- [ ] A payment that fails leaves nothing moved and says so unambiguously
- [ ] A failure reports what is known about it, without predicting whether a retry will succeed
- [ ] Cross-unit payments show what the payee receives and the rate used
- [ ] The payer is told the payee sees the value arriving from their own counterparty
- [ ] Value passing through a party never asks that party for anything, and is visible afterward as
      having passed through
- [ ] Value passing through leaves the party's net worth unchanged

## Variants
- happy: route found, cost accepted, payment completes
- empty: a party with no tallies, or a network with no route — nothing is possible yet
- error: insufficient capacity; cost declined; payment fails partway

## Open

How much of the path to reveal is unsettled. Showing it exposes who a party trades with to people who
have no business knowing; hiding it entirely leaves the payer trusting a number they cannot check.
Worth deciding deliberately rather than by default.
