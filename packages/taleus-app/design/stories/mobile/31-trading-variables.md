# User Story: Trading settings

## Story Overview

I want to say how much value I am willing to hold with each partner, and what I will pay or accept to
have value move — so that payments can flow through me without anyone asking me each time.

Context: Sam has four tallies and has noticed value moving through them. He wants to understand what
he has agreed to, and to use it deliberately: he would like to build up some value with Mara, and he
would rather not have his savings with Jan drained away.
## Roles

Any party, per tally. These settings are that party's alone — the counterparty does not agree to
them, but does read them.

## Sequence

1. Sam looks at what his tally with Mara is currently set to do. He has never touched it, so it is at
   the ordinary default: balances can settle toward zero freely, and nothing accumulates beyond that.
2. He is told what that means in plain terms before he changes anything: value may move through this
   tally to settle what people owe each other, it can only ever reduce what he holds or what he
   owes, and it never changes what he is worth. Nothing can pile up here that he did not ask for.
3. Sam decides he would like to hold about $500 of Mara's credit, because he buys from her often and
   would rather have value parked there than elsewhere. He says so.
4. He is shown the consequence: value will now accumulate here, up to $500, at no charge to anyone
   sending it his way.
5. He sets the most he will ever let build up — $800 — beyond which he wants nothing more, no matter
   who is paying.
6. Between $500 and $800 he can ask for something in return for taking on more, since it is past what
   he wanted. He can also leave that at nothing.
7. He can also say what it takes to draw value *back out* of this tally once he has accumulated it —
   free, at a price, or not at all.
8. He signs the settings. From that point they are standing permission: value moves within them
   without anyone asking Sam again, including while he sleeps.
9. He can come back at any time and see what his settings currently permit, in the same plain terms.

### Alternative Path A: leaving it alone
1.1. Sam never touches any of this, on any tally.
1.2. Everything still works: debts he owes can be paid down, and value does not pile up anywhere he
     did not ask for it.
1.3. He is not made to learn this to use the app.

### Alternative Path B: what he cannot refuse
7.1. Sam tries to set things so that nobody can ever reduce what he owes Mara.
7.2. He cannot. A debt he owes can always be paid down, freely, without his charging for it — an IOU
     is honored without conditions.
7.3. What he controls is what he *accumulates*, not whether he can be released from what he owes.

### Alternative Path C: Mara wants the opposite
1.1. Mara does not want to hold customer credit; she wants it moving.
1.2. She sets things so value passes through her readily, and can pay to make that more attractive to
     others rather than charging for it.

### Alternative Path D: shutting a tally out
1.1. Sam has a tally he wants left entirely alone — no automated movement at all.
1.2. He can say so, and is shown the cost of that: this tally will not help him pay anyone, and
     others will not route through it.
1.3. What he owes on it can still be paid down. That is not something he can switch off.

### Alternative Path E: the same intent across many tallies
1.1. Sam has forty tallies and does not want to set each one.
1.2. He can express what he wants generally and adjust individual tallies where they differ.

### Alternative Path F: changing his mind
8.1. Months later Sam lowers his limit from $800 to $200.
8.2. It is a signed change, like the first one.
8.3. Movement already agreed under the old settings is not undone by the new ones; what changes is
     what happens from here.

### Alternative Path G: value that would cross units
1.1. A payment could settle through Sam only by turning dollars into hours — two of his tallies are
     in different units.
1.2. That does not happen. Sam has never said what an hour is worth to him, and nobody else's opinion
     of it will be used on his behalf.
1.3. If he wants his tallies to work together across units, he says what they are worth to him first.
     → [41](41-my-exchange-rates.md)

## Acceptance Criteria

- [ ] A party can see what a tally's settings currently permit, in plain terms, before changing them
- [ ] Defaults are sensible and usable by someone who never opens these settings
- [ ] A party can state how much value they would like to accumulate on a tally
- [ ] A party can state the most they will ever accumulate on it
- [ ] A party can ask something in return for accumulating beyond what they wanted
- [ ] A party can state what it takes to draw accumulated value back out
- [ ] A party cannot prevent a debt they owe from being paid down, and is told why
- [ ] Settings are signed, and are presented as standing permission rather than a preference
- [ ] Once signed, movement within them happens without further prompting
- [ ] A party can express intent across many tallies without configuring each one
- [ ] Changing settings is itself signed, and does not retroactively affect movement already agreed
- [ ] A party can shut a tally out of automated movement entirely, and is shown what that costs them
- [ ] Default settings permit only movement that reduces what the party holds or owes, and never
      change what they are worth
- [ ] Value never crosses between units a party has not priced; until they do, each unit settles
      within itself

## Variants
- happy: defaults understood, then a target and a ceiling set deliberately
- empty: a party who has never touched any of this — the common case
- error: attempting to block repayment of one's own debt; shutting out a tally and losing reach

## Open

Whether these settings live per tally with an overall default, or are always per tally, is a question
for the engine as much as the app — see `feat-engine-tally-api`. The terms used here are deliberately
plain; the underlying names (target, bound, reward, clutch) are documented in
`docs/trading-variables.md` and should not leak into the interface.
