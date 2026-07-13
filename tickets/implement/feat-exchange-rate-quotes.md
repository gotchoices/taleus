----
description: Let a party that holds tallies in different units set the exchange rates it will trade them at, and define the exact whole-number math that converts value across units during a payment or lift.
prereq: feat-denomination-argument, feat-portfolio-state
files: docs/architecture.md, schema/draft1.qsql
difficulty: hard
----
Background: `docs/architecture.md` § Denominations and Exchange. A party holding tallies in more than one denomination quotes **exchange rates** as private trading policy in its portfolio (`feat-portfolio-state`). This ticket defines the quote structure and the exact, integer-exact conversion + rounding math the lift agent applies during discovery and commit. This is the "prerequisite understanding for denomination-aware routing" that `feat-chipnet-integration` consumes.

Second of two chained tickets from the `feat-multi-denomination` plan; depends on `feat-denomination-argument` for the denomination identifiers and on `feat-portfolio-state` for the private portfolio strand the quote table lives in.

**Distinction from trading variables.** Trading variables (`TradingVariable`, `schema/draft1.qsql`) are published *per tally into the shared strand* — the counterparty reads them. Exchange rates are **private portfolio state**, never shared into a strand; only the party's own lift agent reads them, at decision time.

## Exchange rate quote structure

Lives in the portfolio strand established by `feat-portfolio-state` (private, revisioned, unsigned).

```
ExchangeRateQuote
  FromDenom text        -- denomination the quoting party releases (pays out)
  ToDenom text          -- denomination the quoting party accumulates (receives)
  RateNum integer  > 0  -- effective rate, spread folded in: FromDisplay units per ToDisplay unit
  RateDen integer  > 0  -- rational (RateNum/RateDen) for integer-exact math
  MidNum integer  null  -- optional: mid-market rate before spread (display / re-derivation)
  MidDen integer  null
  SpreadPpm integer null-- optional: spread applied, parts-per-million (display)
  ValidFrom text        -- date; quote usable from
  ValidUntil text       -- date; quote usable until
  Revision integer
  primary key (FromDenom, ToDenom, Revision)
```

- **Directional.** A pair has two rows (From→To and To→From) because spread is asymmetric. The effective `RateNum/RateDen` already folds the party's conversion cost — the multi-denomination generalization of the trading-variable `Reward`. `Mid*`/`SpreadPpm` are optional, for display and re-deriving the effective rate. Spread is normally ≥ 0 (a cost) but a subsidy (negative `SpreadPpm`) is permitted, mirroring `Reward`'s signed semantics.
- **Display-level, scale-independent.** The rate is defined at each denomination's *display* unit (1 USD, 1 CHIP), NOT at smallest-unit granularity — so a quote is independent of any tally's per-contract scale. Scales enter only at conversion time, from each edge's contract.
- **Validity window.** Discovery uses a quote valid at discovery time; committed lift terms bind regardless of later expiry. The quoting party bears rate movement between quote and commit, bounded by the window it chose.
- **Unsigned.** Private state, so no signature; revisioned/timestamped so the lift agent reads the latest valid quote.

## Conversion + rounding — the exact math

Value flows from payer toward payee. Discovery walks the route **backward from the payee**, converting the required amount denomination by denomination until it reaches the originator's own edge.

At each conversion boundary, let the *downstream* tally (nearer the payee) be denomination `D_out`, scale `s_out`, with required amount `req_out` (integer smallest-units of `D_out`) already computed. The *upstream* tally (nearer the payer) is `D_in`, scale `s_in`. The intermediary between them quotes the rate `RateNum/RateDen` from its `ExchangeRateQuote` row `From = D_in, To = D_out` (in-display per out-display). Required upstream smallest-units:

```
req_in = ceil( req_out * RateNum * 10^(s_in)  /  ( RateDen * 10^(s_out) ) )
```

All whole-number arithmetic, one ceiling. **Compute the intermediate product with BigInt** (cross-platform) and **reduce `RateNum/RateDen` to lowest terms** before multiplying, to avoid 64-bit overflow on large amounts × large rates × large scales; ceil via integer division. This overflow strategy is the decision — do not leave it open.

The party paying the upstream edge rounds **up** so the downstream party is never shorted; the sub-unit remainder (< 1 smallest-unit of `D_in` per edge) is borne upstream, cascading to the originator.

Degenerate case — same denomination, equal scale, no spread → `RateNum = RateDen = 1`, `s_in = s_out` → `req_in = req_out`. The ceiling is a no-op; exactly MyCHIPs behavior.

Discovery accumulates `req` across every boundary end-to-end; the value at the originator's own edge is the **exact source-denomination cost** of delivering the target amount, presented before commit. Trading-variable fees compose per the existing `LiftLading` rule (`NewRate = PriorRate + MyRate * (1 - PriorRate)`, `schema/draft1.qsql`) and apply per edge alongside the denomination conversion — the conversion is the multiplicative scale change, the fee ratio is the accumulated cost. `feat-chipnet-integration` integrates both into route advertisement.

**Who absorbs the remainder: the originator** — the payer for a linear lift/payment, the initiator for a circular clearing lift. Every intermediary and the payee receive at least their exact integer due; the per-edge ceiling dust accrues upstream to the originator and is disclosed as the exact source cost during discovery.

**Commit binds each edge's integer units in that edge's own denomination** — the ceiled values — so no participant bears rate movement after signing.

**Payments** are specified in the recipient's denomination (payee receives exactly `A` smallest-units); the backward walk yields the payer's exact source cost.

## Edge cases & interactions

- **Degenerate single-denomination lift**: all rates 1, equal scales → identical to current MyCHIPs behavior. Regression test: ceil is a no-op, `req` unchanged edge to edge, originator cost == payee amount.
- **Missing / expired quote** at a boundary during discovery → that edge cannot convert → the route is pruned. The lift agent must never fabricate a rate.
- **Validity straddling discovery→commit**: quote valid at discovery, expires before commit → commit still binds the discovered terms (fixed at commit); the quoting party bears the movement within its own chosen window. No error.
- **Direction correctness**: From/To semantics and the backward-walk formula tested in *both* directions and across a 3+ denomination chain (e.g. CHIP → USD → labor-hours) so the accumulated product is exact.
- **Rounding accumulation**: a route of N conversion boundaries can add up to N sub-units of originator cost — bounded and acceptable. Leave a `NOTE:` comment at the conversion site (tripwire — only matters if very long routes ever appear).
- **Overflow**: handled by the BigInt + lowest-terms decision above; the `NOTE:` at the conversion site should state the strategy so a future reader does not "optimize" it back to 64-bit multiply.
- **Quote guards**: `RateNum > 0`, `RateDen > 0`, `ValidUntil >= ValidFrom`.
- **Circular clearing lift across denominations**: the initiator's two edges close the loop; net-zero in value but the initiator absorbs the loop's rounding dust. Test a 3-node cross-denomination circular lift: every intermediary nets ≥ 0, the initiator carries the remainder.

## TODO

- Define `ExchangeRateQuote` in the portfolio strand schema from `feat-portfolio-state` (private, revisioned, unsigned) with the guards above.
- Update `docs/architecture.md` § Denominations and Exchange with: the display-level rate definition, the exact `req_in` conversion+rounding formula, the who-absorbs-the-remainder rule, and the `ExchangeRateQuote` structure. This is the section `feat-chipnet-integration` reads.
- Add a `NOTE:` comment at the (future) conversion site describing the rounding-dust accumulation and the BigInt/lowest-terms overflow strategy.
- Tests (specified here up front; they land when the conversion helper / lift agent is built under `feat-chipnet-integration`):
  - degenerate single-denomination lift == current behavior (`req` unchanged; originator cost == payee amount).
  - two-denomination payment (payee wants `A` USD-cents; payer sees exact CHIP source cost == the ceil formula).
  - three-denomination chain accumulates the conversion product exactly, in both directions.
  - missing / expired quote prunes the boundary.
  - rounding dust borne by the originator; every intermediary nets ≥ 0.
  - overflow bound honored for large amounts / large scales.
