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
   tally to settle what people owe each other, but only ever *downward* — shrinking what he holds or
   what he owes toward zero. Nothing accumulates here that he did not ask for, and nothing he owes
   grows without his say-so.
3. Sam decides he would like to hold about $500 of Mara's credit, because he buys from her often and
   would rather have value parked there than elsewhere. He says so.
4. He is shown the consequence: value will now accumulate here, up to $500, at no charge to anyone
   sending it his way.
5. He sets the most he will ever let build up — $800 — beyond which he wants nothing more, no matter
   who is paying.
6. Between $500 and $800 he is being asked to hold more than he wanted, so he attaches a price to it:
   one percent. Value above his target moves onto this tally only if that cost is covered by whoever
   is sending it, and below $500 it moves for nothing.
7. Drawing value back out he leaves free. Parking value with Mara is only useful if he can spend it
   with her, and charging himself for that would defeat the point.
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
7.3. What he controls is growth, not repayment. Left alone, this tally only ever settles downward;
     what his settings buy him is permission for the balance to grow in a direction he chose — and
     even then only as far as both his own ceiling and the limit the other party extended him allow.

### Alternative Path C: Mara wants the opposite
1.1. Mara does not want to hold customer credit; she wants it moving.
1.2. She sets what she would like to hold to nothing, so no lift ever leaves value parked with her.
1.3. And rather than charging to let value move out through her, she gives up a little — half a
     percent — to make her tallies the attractive route. She is paying to keep her books clear, which
     for a shop is worth more than the half percent.

### Alternative Path D: shutting a tally out
1.1. Sam has a tally he wants left entirely alone — no automated movement at all.
1.2. He can say so, and is shown the cost of that: this tally will not help him pay anyone, and
     others will not route through it.
1.3. His refusal is enough on its own. A lift needs both parties to permit it, so it does not matter
     how willing the other side is — either of them can stop it.
1.4. The exception is what he owes. That can always be paid down, and it is not something he can
     switch off.

### Alternative Path E: the same intent across many tallies
1.1. Sam has forty tallies and does not want to set each one.
1.2. Having decided what he wants on one, he can apply it to others he chooses — a group he picks,
     not everything he holds. Applying one number to forty different relationships without looking is
     exactly the mistake worth making him take a beat over.
1.3. He can see which tallies are still sitting at their defaults, since those are usually the ones he
     meant to get to.
1.4. Anything he did not include is left exactly as it was.

### Alternative Path F: changing his mind
8.1. Months later Sam lowers his limit from $800 to $200.
8.2. It is a signed change, like the first one, and it binds from the moment he makes it. Unlike the
     credit he extends to Mara — where tightening owes her notice ([03](03-negotiate-terms.md)) —
     this is his own participation, not a promise to her, so nobody is owed warning of it.
8.3. Anything already agreed completes on the old terms; everything from here uses the new ones.

### Alternative Path G: a payment that would have to cross units
1.1. Sam tries to pay a supplier $200. The only way value reaches them runs out through his hours
     tally with Dave, which means turning dollars into hours.
1.2. It does not go through, and he is told why: he has never said what an hour is worth to him, and
     nobody else's opinion of it will be used on his behalf.
1.3. He is offered the thing that would change it — saying what an hour is worth
     ([41](41-my-exchange-rates.md)) — and told what saying it would permit.
1.4. Lifts running entirely in dollars were never affected and carried on throughout.

## Acceptance Criteria

- [ ] A party can see what a tally's settings currently permit, in plain terms, before changing them
- [ ] Defaults are sensible and usable by someone who never opens these settings
- [ ] A party can state how much value they would like to accumulate on a tally
- [ ] A party can state the most they will ever accumulate on it
- [ ] A party can attach a price to accumulating beyond what they wanted, and value moves past that
      point only if the price is covered
- [ ] A party can state what it takes to draw accumulated value back out
- [ ] A party cannot prevent a debt they owe from being paid down, and is told why
- [ ] Settings are signed, and are presented as standing permission rather than a preference
- [ ] Once signed, movement within them happens without further prompting
- [ ] A party can apply a setting to a group of tallies they choose, leaving the rest untouched
- [ ] A party can see which tallies still sit at their defaults
- [ ] Changing settings is itself signed, binds immediately, and does not disturb movement already
      agreed
- [ ] Changing these settings owes the counterparty no notice, unlike tightening the credit extended
      to them
- [ ] A party can shut a tally out of automated movement entirely, and is shown what that costs them
- [ ] Either party's refusal is sufficient to keep a lift off a tally
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
