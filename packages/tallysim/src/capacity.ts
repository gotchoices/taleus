/**
 * The capacity model: how far value can move across one tally in a given direction before it hits a
 * credit bound. This is the MyCHIPs lift-capacity idea reduced to what the oracle needs — raw
 * credit-limit room, answering *does capacity exist* — and it deliberately **omits** trading-variable
 * fee structure (`target`/`bound`/`reward`/`clutch`, the `LiftLading` view in `docs/architecture.md`):
 * those bound a lift's *cost* and which routes an agent *prefers*, not whether a route physically exists.
 * See `docs/design.md` § Capacity model and the forward pointer to `feat-tallysim-trading-model`.
 *
 * "Value flows X → Y" means Y ends up better off (X takes on the obligation). The balance `b` is the
 * units the foil owes the stock, so `b ∈ [-foilCreditLimit, +stockCreditLimit]`. Then, per tally between
 * stock `S` and foil `F`:
 *
 *     cap(F → S) = stockCreditLimit - b     // value flows foil→stock: b rises toward +stockCreditLimit
 *     cap(S → F) = b + foilCreditLimit      // value flows stock→foil: b falls toward -foilCreditLimit
 *
 * Both are non-negative, and `cap(F→S) + cap(S→F) = stockCreditLimit + foilCreditLimit` (the total swing,
 * independent of `b` — the balance only sets the *split*). A zero-capacity direction (`b` at a bound) is
 * a valid, expected state. An `Infinity` credit limit yields an `Infinity` capacity in that direction.
 */

import type { Tally } from './model.js'

/** Directed capacity for value flowing foil → stock: `stockCreditLimit - balance`. Non-negative. */
export function capFoilToStock(tally: Tally): number {
	return tally.stockCreditLimit - tally.balance
}

/** Directed capacity for value flowing stock → foil: `balance + foilCreditLimit`. Non-negative. */
export function capStockToFoil(tally: Tally): number {
	return tally.balance + tally.foilCreditLimit
}

/**
 * The total swing of a tally: `stockCreditLimit + foilCreditLimit`. Equals
 * `capFoilToStock(t) + capStockToFoil(t)` for any balance (the identity the capacity model rests on).
 */
export function totalSwing(tally: Tally): number {
	return tally.stockCreditLimit + tally.foilCreditLimit
}
