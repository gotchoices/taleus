/**
 * Cross-denomination conversion at one lift/payment boundary (see
 * docs/architecture.md § Cross-denomination conversion). Discovery walks
 * backward from the payee, converting the required amount denomination by
 * denomination; this is that one-boundary step. `D_out` is the downstream
 * tally (nearer the payee), `D_in` the upstream tally (nearer the payer):
 *
 *   req_in = ceil( req_out * RateNum * d_in / ( RateDen * d_out ) )
 *
 * where d is each tally's TallyContract.DenominationDivisor (sub-units per whole).
 *
 * Rounds UP so the downstream party is never shorted; the sub-unit
 * remainder is borne upstream, cascading to the originator.
 *
 * NOTE: OVERFLOW STRATEGY -- decided; do NOT "optimize" this back to a
 * native 64-bit multiply. `reqOut * rateNum * divisorIn` overflows 64 bits
 * on large amount x large rate x large divisor. Reduce rateNum/rateDen to
 * lowest terms, then compute the intermediate product with BigInt
 * (cross-platform) and take the ceiling via integer division. Mirrored from
 * the rate definition's NOTE: in schema/portfolio.qsql -- keep both in sync.
 *
 * A missing or expired quote is not this function's job: the caller (lift
 * agent) prunes the route before ever reaching here, so this always
 * receives an already-resolved, valid quote. Trading-variable fees compose
 * separately per the LiftLading rule, alongside this conversion, not inside
 * it.
 */
export interface ConversionBoundary {
	/** Required smallest-units of D_out, already computed downstream (nearer the payee). */
	reqOut: bigint
	/** Intermediary's ExchangeRateQuote.RateNum for From = D_in, To = D_out (in-display per out-display). */
	rateNum: bigint
	/** Intermediary's ExchangeRateQuote.RateDen for the same row. */
	rateDen: bigint
	/** D_in's TallyContract.DenominationDivisor (upstream, nearer the payer). */
	divisorIn: number
	/** D_out's TallyContract.DenominationDivisor (downstream, nearer the payee). */
	divisorOut: number
}

function gcd(a: bigint, b: bigint): bigint {
	let x = a < 0n ? -a : a
	let y = b < 0n ? -b : b
	while (y !== 0n) {
		;[x, y] = [y, x % y]
	}
	return x
}

function assertPositiveInt(value: number, name: string): void {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive integer, got ${value}`)
	}
}

/** Converts a downstream requirement to the upstream requirement across one conversion boundary. */
export function convertBoundary(boundary: ConversionBoundary): bigint {
	const { reqOut, rateNum, rateDen, divisorIn, divisorOut } = boundary

	if (reqOut < 0n) {
		throw new Error(`reqOut must be >= 0, got ${reqOut}`)
	}
	if (rateNum <= 0n || rateDen <= 0n) {
		throw new Error(`rateNum/rateDen must be > 0, got ${rateNum}/${rateDen}`)
	}
	assertPositiveInt(divisorIn, 'divisorIn')
	assertPositiveInt(divisorOut, 'divisorOut')

	const common = gcd(rateNum, rateDen)
	const num = rateNum / common
	const den = rateDen / common

	const numerator = reqOut * num * BigInt(divisorIn)
	const denominator = den * BigInt(divisorOut)

	return (numerator + denominator - 1n) / denominator
}
