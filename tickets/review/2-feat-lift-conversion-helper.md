description: Built and tested the whole-number math routine that converts an amount from one tally's currency unit to another during a cross-currency payment or lift, always rounding so nobody gets shorted.
prereq:
files: src/lift/convert.ts, src/lift/convert.test.ts, schema/portfolio.qsql, docs/architecture.md
----
Implemented `convertBoundary` in `src/lift/convert.ts` — the pure function `feat-exchange-rate-quotes` specified but left unwritten (its review said "the conversion helper lands under `feat-chipnet-integration`"; since it has no ChipNet/network dependency it was pulled forward to stand alone). `feat-lift-agent-discovery` is its consumer.

## What was built

```ts
export interface ConversionBoundary {
	reqOut: bigint    // required smallest-units of D_out (downstream, nearer payee)
	rateNum: bigint   // ExchangeRateQuote.RateNum, From = D_in, To = D_out
	rateDen: bigint   // ExchangeRateQuote.RateDen, same row
	scaleIn: number   // D_in's TallyContract.DenominationScale (upstream, nearer payer)
	scaleOut: number  // D_out's TallyContract.DenominationScale (downstream, nearer payee)
}
export function convertBoundary(boundary: ConversionBoundary): bigint
```

Implements `req_in = ceil( req_out * RateNum * 10^(s_in) / ( RateDen * 10^(s_out) ) )`, reducing `RateNum/RateDen` to lowest terms and doing the whole computation in `BigInt` per the fixed overflow-strategy decision (no native 64-bit multiply). Preconditions asserted (throw): `reqOut >= 0`, `rateNum > 0`, `rateDen > 0`, `scaleIn`/`scaleOut` non-negative integers. A missing/expired quote is explicitly documented as out of scope — the caller (lift agent) prunes the route before calling this; not defensively handled here.

**Inputs/outputs are all `bigint`**, not `number` — chosen deliberately since the overflow-bound requirement (large amount × large rate × large scale) means intermediate products routinely exceed `Number.MAX_SAFE_INTEGER`, and the schema's `Units`/`RateNum`/`RateDen` are unbounded SQL `integer` columns. Callers (the future lift agent / discovery code) convert from whatever the Quereus driver returns into `BigInt` at the call boundary; this function never touches `number` internally.

**Not exported from `src/index.ts`** — `feat-taleus-lib-scaffolding`'s scaffolding re-exports `crypto` at the package root because it's public API surface consumed outside the lib; `convertBoundary` is internal plumbing the lift agent will import by relative path (`src/lift/discovery.ts` etc., not built yet), so no barrel/export wiring was added. Revisit if a later ticket wants it public.

**Docs/schema NOTE cross-references updated** — both `schema/portfolio.qsql`'s conversion NOTE and `docs/architecture.md` § Cross-denomination conversion previously pointed at `feat-chipnet-integration` as the (not-yet-existing) implementation site. Updated both to point at the now-landed `src/lift/convert.ts`; schema NOTE text is unchanged otherwise (still the documentation-of-record), code file mirrors the overflow contract per the ticket's instruction.

## Tests (`src/lift/convert.test.ts`, 9 cases, `yarn test` green)

Covers the ticket's 7-case floor plus 2 extra:
- degenerate single-denomination no-op (`RateNum=RateDen=1, s_in=s_out`), including `reqOut=0`
- two-denomination payment (1.5 CHIP @ scale 3 ⇄ USD @ scale 2, exact division)
- three-denomination chain, both walk directions (A→B→C and C→B→A), composing two `convertBoundary` calls each
- exact-vs-remainder rounding boundary (24/2 exact vs 21/2 → rounds up by exactly 1)
- circular clearing lift (all rates 1, chained across two boundaries, result unchanged)
- overflow bound: `1e15 * 1e5 * 10^10 = 1e30`, far past `Number.MAX_SAFE_INTEGER` and a native 64-bit multiply, exact-division so it isolates the BigInt product path from the rounding path
- lowest-terms reduction (500/200 vs pre-reduced 5/2 give identical results)
- precondition assertions (negative `reqOut`, zero rate, negative/non-integer scale all throw)

**Missing/expired quote is documented, not tested** — per the ticket, that's the caller's job (route pruning), not this function's; a comment at the bottom of the test file states this explicitly rather than leaving it silently absent.

`yarn test` (full suite, 15 tests / 2 suites), `yarn lint`, and `yarn build` all pass clean — no pre-existing failures encountered.

## Known gaps / reviewer should check

- No integration test wiring this into an actual discovery/agent call path — none exists yet (`feat-lift-agent-discovery` is downstream). The 9 unit tests exercise the function in isolation only.
- The "three-denom chain both directions" and "circular clearing lift" tests hand-verify expected values by manual arithmetic in the test comments; worth a spot-check that the arithmetic notes are right (I recomputed each by hand twice, but this is exactly the kind of off-by-one spot a second pair of eyes catches).
- `assertNonNegativeInt` also runs on `scaleOut`/`scaleIn` even though schema `DenominationScale` already has a `>= 0` check at the DB layer — this is defense-in-depth for a function that doesn't know its caller resolved a schema row correctly (e.g. a test or future caller passing a raw literal). Flagging in case reviewer feels it's belt-and-suspenders beyond the ticket's ask; I judged it consistent with "assert the precondition" for `RateNum > 0`/`RateDen > 0`, and cheap.
