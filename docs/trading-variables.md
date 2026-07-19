# Trading Variables

Trading variables are each party's **published, unilateral lift policy** for a tally: they tell the
counterparty's lift agent how much balance movement this party will accept, and at what cost. They
drive **lifts** (automated credit clearing); they do not gate **direct chits** (a party may pledge
directly to its counterparty at any time for any reason — see [Contract governance](tally-lifecycle.md#contract-governance)).

Schema: [`TradingVariable`](../packages/taleus/schema/draft1.qsql) — per-party, revisioned, insert-only,
grantor-signed. The latest-revision resolver is `CurrentTradingVariable`; capacity is advertised by
`LiftLading`.

## Two full sets, not one

Each party sets **its own four** variables and signs them unilaterally; they control lifts **from that
party's own perspective**. A tally therefore carries **eight** values (four per party), not four.

| Variable | Meaning (from the issuing party's perspective) | Guard |
|---|---|---|
| `Target` | Ideal balance to accumulate via lifts — lifts may raise the balance to `Target` free of charge | `Target ≥ 0` |
| `Bound` | Maximum balance the party will accrue through lifts | `Bound ≥ Target` |
| `Reward` | Fee ratio charged for accumulation **above** `Target`, up to `Bound` (ppm; positive = fee, negative = subsidy) | — |
| `Clutch` | Fee ratio charged for **drops** — lifts that reduce the balance this party has accumulated (ppm) | — |

Ratios are parts-per-million (`10000` = 1%). `Clutch = 1000000` effectively blocks drops. A party that
publishes nothing trades at the all-zero defaults: lifts may pay its accumulated balance down to zero
for free and accumulate nothing beyond that.

### Why two sets are non-redundant

Balance is a single signed number on one shared record, but each party's variables govern **its own side
of zero, in its own direction**. This is the MyCHIPs `doc/uml/trade-seq.puml` number-line, in Taleus
terms (positive = value the **stock** party, Party S, has accumulated; F sees the negation):

```
   F's Bound        F's Target      0      S's Target        S's Bound
   (most neg.)  ······  F's limit ··│·· S's limit  ······  (most pos.)
   ◄──────────  Party F's side  ────┼────  Party S's side  ──────────►
        Client/Foil variables       │       Vendor/Stock variables
```

S's credit limit caps how far the balance may **rise** (F's debt to S); F's limit caps how far it may
**fall** (S's debt to F). They are mirror images — you cannot collapse them into one set without losing
the direction each party is protecting.

> **Reframing from MyCHIPs.** In MyCHIPs the *meaning* of a variable flipped depending on whether you
> held the stock or the foil (a foil's `reward` was a "lift margin", a stock's the same field was a
> "drop margin"). Taleus removes the flip: a variable always means the same thing, expressed from the
> **issuing party's own perspective**. Same expressive power, no stock/foil case analysis.

## How a lift reads both sets

A lift direction is named by its **receiver** — the party whose perspective balance rises; the
counterparty releases the same value (perspective balances are negations of each other). `LiftLading`
computes, per direction:

- **`FreeUnits`** — receiver accumulation up to its `Target`, no fee. Additionally capped by the credit
  the **receiver** granted the counterparty (`min(Bound, receiver's CreditLimit)`).
- **`RewardedUnits`** — further accumulation up to `Bound`, charged at the **receiver's** `Reward`.
- **`Clutch`** — the **releasing** counterparty's charge, applied to the whole moved amount.

So a single lift touches **both** parties' variables at once: the receiver's `Reward` **and** the
releaser's `Clutch`. Fees compose along a route as `NewRate = PriorRate + MyRate × (1 − PriorRate)`, and
across a denomination boundary the conversion multiplies alongside (see [denominations.md](denominations.md)).

## Advisory view vs. hard gate

`LiftLading` is a **view** — advisory capacity the agent reads to size and price a lift. It is *not* the
enforcement point. The hard schema gate on a lift pledge is the **credit limit** (`WithinReservedCredit`
on `PendingLift`), not the trading variables. Conformance of a pledge to the issuer's trading variables
is **agent-enforced**: a `PendingLift` is self-signed by the issuer, so a party only ever commits what
its **own** agent signs, and TV interpretation (reward/clutch pricing, route economics) is too rich for a
CHECK constraint. See the good-faith timing rule in [Contract governance](tally-lifecycle.md#contract-governance):
a lift chit valid under the variables in force **when it was signed** stays valid even if the party
records new variables microseconds later; the new policy binds only later lifts.

## Trading variables live in the shared strand — exchange rates do not

Trading variables are **signed, unilateral policy the counterparty must read** to advertise route
capacity, so they live in the shared tally strand. **Exchange rates**, by contrast, span a party's
multiple tallies and are private to its own agent — they live in the [portfolio](architecture.md#portfolio),
never in a tally strand. Do not conflate the two: a trading variable prices movement *within* one tally;
an exchange rate prices crossing *between* two of a party's tallies' denominations.

## Open questions

None outstanding — this area is settled and implemented in the schema. The one adjacent open item is how
richer *credit terms* (interest, amortization) interact with lift economics, tracked in
[drafts/credit-terms.md](drafts/credit-terms.md).
