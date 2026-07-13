description: Reviewed the whole-number math routine that converts an amount from one tally's currency unit to another during a cross-currency payment or lift, always rounding so nobody gets shorted.
prereq:
files: src/lift/convert.ts, src/lift/convert.test.ts, schema/portfolio.qsql, docs/architecture.md
----
Reviewed the implement stage of `feat-lift-conversion-helper`, which landed `convertBoundary` in `src/lift/convert.ts` — the pure single-boundary conversion function that `feat-exchange-rate-quotes` specified as a NOTE-only contract and left unwritten. It has no ChipNet/network dependency, so it was pulled forward to stand alone; `feat-lift-agent-discovery` is its consumer.

Formula implemented:

```
req_in = ceil( req_out * RateNum * 10^(s_in) / ( RateDen * 10^(s_out) ) )
```

All-BigInt, `RateNum/RateDen` reduced to lowest terms, ceiling via integer division. Signature:

```ts
export function convertBoundary(boundary: ConversionBoundary): bigint
// ConversionBoundary: { reqOut, rateNum, rateDen: bigint; scaleIn, scaleOut: number }
```

## Review findings

### Correctness — verified, no defects

- **Formula + ceiling** hand-verified against all 9 test cases and re-derived independently: `(numerator + denominator - 1n) / denominator` is the correct ceiling for `numerator >= 0`, `denominator > 0` (both guaranteed by preconditions). `reqOut = 0` → `0` (verified). Matches the `schema/portfolio.qsql` NOTE contract and `docs/architecture.md` § Cross-denomination conversion exactly.
- **Lowest-terms reduction is value- and ceiling-preserving.** Dividing `rateNum`/`rateDen` by their gcd leaves the rational `rateNum/rateDen` identical, so the ceiled result is unchanged — proved algebraically and confirmed by the dedicated 500/200-vs-5/2 test.
- **Quote direction** — the interface keys `rateNum`/`rateDen` as `From = D_in` (upstream/received), `To = D_out` (downstream/released). This matches the *corrected* schema column semantics (the inversion bug the `feat-exchange-rate-quotes` review caught and fixed) and the `From = D_in, To = D_out` assert that the downstream consumer `feat-lift-agent-discovery` specifies. No re-inversion.

### Overflow — verified

- Whole computation is BigInt; no native 64-bit multiply. The overflow-bound test drives `1e15 * 1e5 * 10^10 = 1e30`, far past `Number.MAX_SAFE_INTEGER` and a 64-bit product, exact result. Honors the fixed overflow decision recorded in the schema/docs NOTEs.

### Error handling — verified

- Preconditions (`reqOut >= 0`, `rateNum/rateDen > 0`, non-negative integer scales) throw with messages — not eaten, not control flow. All five throw paths tested. Consistent with the schema's `RateNum > 0`/`RateDen > 0`/`DenominationScale >= 0` guards (defense-in-depth against a caller passing a raw literal — judged appropriate, matches the `RateNum > 0` precondition style).

### Tests — adequate

- Covers the specified 7-case floor (degenerate single-denom incl. `reqOut=0`, two-denom payment, three-denom chain both walk directions, exact-vs-remainder rounding boundary, circular clearing lift, overflow bound) plus 2 extra (lowest-terms reduction, precondition assertions). Happy path, edge, error paths, and multi-boundary composition (with a real ceiling in the chain) all exercised.
- **Missing/expired quote** is documented-not-tested at the bottom of the test file — correct: route pruning on a missing quote is the caller's (lift agent's) job, so there is no input shape for this function to reject. Not a gap.

### Docs / schema — verified against the code, accurate

- `schema/portfolio.qsql` conversion NOTE and `docs/architecture.md` § Cross-denomination conversion both updated from the stale `feat-chipnet-integration` "future implementation site" pointer to the now-landed `src/lift/convert.ts` (`convertBoundary`). Overflow NOTE text preserved and mirrored in the code file's docstring; the two are in sync. No other file needed touching — read every file the change touches plus the downstream discovery ticket to confirm.

### Lint / build / test — pass clean

- `yarn lint`, `yarn build`, `yarn test` (full suite, 15 tests / 2 suites) all green. `tsconfig.build.json` correctly excludes `*.test.ts`; `dist/lift/convert.js` emitted. No pre-existing failures (`.pre-existing-known.md`/`.pre-existing-error.md` clean).

### Tripwires — none new; existing one correctly placed

- The **rounding-dust accumulation** tripwire (a route of N boundaries adds up to N sub-units of extra originator cost) is already parked as a `NOTE:` in `schema/portfolio.qsql`. It belongs there and in the docs, not at the `convertBoundary` site: `convertBoundary` is single-boundary and has no accumulation loop — the accumulation happens in the discovery walk (`feat-lift-agent-discovery`), which is where a running-total concern would live. No new tripwire filed.

### New tickets — none

- No major findings. The two things the implementer flagged for reviewer judgment are non-issues: (1) `gcd()`'s abs-handling is unreachable given the positive-value preconditions but is harmless standalone defense — not worth changing; (2) lowest-terms reduction yields negligible overflow benefit under BigInt (BigInt alone suffices) but is a fixed decision synced with the schema NOTE — keep for parity. Neither warrants an inline fix or a ticket.

## Known-good handoff

`convertBoundary` is internal plumbing, imported by relative path — deliberately not re-exported from `src/index.ts`. The downstream consumer `feat-lift-agent-discovery` will import it and supply the accumulation loop; that ticket already asserts the `From = D_in, To = D_out` direction this function expects.
