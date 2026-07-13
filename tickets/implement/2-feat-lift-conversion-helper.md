----
description: Build the small, exact whole-number math routine that converts an amount from one tally's currency unit to another during a cross-currency payment or lift, always rounding so nobody gets shorted.
prereq: feat-taleus-lib-scaffolding
files: src/lift/convert.ts (new), src/lift/convert.test.ts (new), schema/portfolio.qsql (the conversion NOTE block), docs/architecture.md (§ Cross-denomination conversion)
difficulty: easy
----

`feat-exchange-rate-quotes` specified this helper but left it unwritten — its review says "the conversion helper lands under `feat-chipnet-integration`." It is a pure function with no ChipNet or network dependency, so it lands first and stands alone with a full test suite. The discovery ticket (`feat-lift-agent-discovery`) consumes it.

## The function

Given the downstream (payee-side) requirement, compute the upstream (payer-side) requirement across one conversion boundary:

```
req_in = ceil( req_out * RateNum * 10^(s_in)  /  ( RateDen * 10^(s_out) ) )
```

- `req_out` — integer smallest-units of `D_out` (downstream, nearer payee), already computed.
- `s_in`, `s_out` — the two tallies' `DenominationScale`s (from each edge's own `TallyContract`).
- `RateNum/RateDen` — the intermediary's `ExchangeRateQuote` row for `From = D_in, To = D_out` (in-display per out-display).
- Rounds **up** so the downstream party is never shorted; the sub-unit remainder is borne upstream (ultimately the originator — see docs).

**Overflow rule (fixed decision, do not regress).** `req_out * RateNum * 10^(s_in)` overflows 64 bits on large amount × large rate × large scale. Reduce `RateNum/RateDen` to lowest terms and compute the intermediate product with **BigInt** (cross-platform), taking the ceiling via integer division. This is the instruction carried in the `NOTE:` at the rate definition in `schema/portfolio.qsql` — move/mirror it here as the implementation contract. Do **not** use a native 64-bit multiply.

## Edge cases & interactions

- **Degenerate single-denomination case**: same denomination, equal scale, no spread → `RateNum = RateDen = 1`, `s_in = s_out`; the ceiling is a no-op and the result equals `req_out` exactly (MyCHIPs behavior). Must be a test.
- **Rounding boundary**: an exact-division case (no remainder) must **not** round up by one; a case with remainder must round up by exactly one smallest-unit.
- **Overflow bound**: a case with large `req_out`, large `RateNum`, and large `s_in` that would overflow a native 64-bit multiply must produce the correct BigInt result — the guard against regression.
- **Missing/expired quote is not this function's job**: the caller (agent) prunes the route when no valid quote exists; this helper is only invoked with a resolved quote. Document that boundary so it is not defensively mis-handled here.
- **Negative spread (subsidy)** is permitted upstream (`reward`-signed semantics), but `RateNum > 0`, `RateDen > 0` always hold (schema guards); assert the precondition.
- **Interaction with fees**: trading-variable fees compose per the `LiftLading` rule *alongside* this conversion, not inside it — keep the multiplicative scale change (this helper) separate from the fee ratio (agent). Do not fold fees in here.

## Key tests (the 7-case floor from `feat-exchange-rate-quotes`)

Degenerate single-denom (no-op) · two-denom payment · three-denom chain both directions · missing/expired quote handled by caller (documented, not tested here) · exact-vs-remainder rounding · circular clearing lift (all rates 1) · overflow bound (BigInt correctness). Expected: every non-degenerate boundary rounds up so the downstream due is always met; the degenerate cases reduce to identity.

## TODO

- Write `src/lift/convert.ts`: the BigInt, lowest-terms, ceiling helper with the precondition asserts.
- Move/mirror the overflow `NOTE:` contract from `schema/portfolio.qsql` to the code site.
- Write `src/lift/convert.test.ts` covering the floor above; `yarn test` green (stream with `tee`).
