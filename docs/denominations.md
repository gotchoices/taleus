# Denominations — Quantifying a Unit of Account

A core Taleus generalization over MyCHIPs: a tally is kept in **any** unit of account its contract
names, not only CHIPs. This doc is the *quantification model* — how a unit is named and how amounts are
counted. The runtime mechanics (conversion formula, overflow rule, discovery) live in
[architecture.md § Denominations and Exchange](architecture.md#denominations-and-exchange); this doc is
the conceptual companion and records why the **multiplier** is an integer divisor.

## Three properties quantify a unit

Any unit of account is captured by three properties. Taleus's schema realizes them as
`TallyContract.Denomination`, `Ledger.Units`, and `TallyContract.DenominationDivisor`.

| Property | What it is | Schema today |
|---|---|---|
| **Designator** | Which unit (USD, CHIP, BTC, a custom unit) | `Denomination` — a namespaced identifier |
| **Sub-units** | Integer count of the smallest unit the tally transacts in (cents, milliCHIPs, satoshis) | `Ledger.Units` (integer ≥ 1) |
| **Multiplier** | How many sub-units make one display unit | `DenominationDivisor` (an **integer** ≥ 1) |

All ledger math is in integer sub-units — no floats for money, ever. The display unit is a presentation
concern.

## Designator: a namespaced identifier (superset of currency codes)

The designator is dispatched by prefix — three namespaces, no general parser, no currency-table lookup:

- **`CHIP`** — the network reference unit; a reserved bare token, no prefix.
- **`iso4217:<AAA>`** — a national currency; `<AAA>` is three uppercase letters, validated by **shape
  only**. This already covers the "3-letter code" model *and* its X-extensions: ISO 4217 reserves `X`
  codes (`XAU` gold, `XDR`, `XXX` = no currency), so `iso4217:XAU` passes with no special case.
- **`cid:<contentaddress>`** — a custom / open-ended unit, named by the content address of a **descriptor
  document**. Globally unique by construction (two parties referencing the same descriptor reference the
  same CID; two different descriptors cannot collide).

So the namespaced scheme is a strict **superset** of "3-letter code + `Xxx` extensions": mainstream
currencies use `iso4217:`, CHIP is bare, and anything else — a labor-hour, a commodity, a private token —
is a `cid:` descriptor. `ValidDenomination` enforces exactly these three shapes at proposal and
acceptance.

## Multiplier: an integer divisor

`DenominationDivisor` is how many `Units` make one whole of the display unit, any integer ≥ 1:

| Unit | Divisor | So `Units` counts | `150` reads as |
|---|---|---|---|
| `iso4217:USD` | 100 | cents | $1.50 |
| `CHIP` | 1000 | milliCHIPs | 0.150 CHIP |
| an hour (`cid:`) | 60 | minutes | 2 h 30 min |
| a dozen (`cid:`) | 12 | eggs | 12 and 6/12 |
| a pound (`cid:`) | 16 | ounces | 9 lb 6 oz |
| a Goldback (`cid:`) | 1 | Goldbacks | 150 |

The divisor is authoritative (for `iso4217:` it is *not* cross-checked against a currency table — the
contract wins). Default `CHIP` divisor 1 reproduces the implicit single-denomination behavior exactly.
A currency whose minor unit is not a power of ten (the Malagasy ariary is five iraimbilanja) is a
divisor like any other.

**Why an integer, not a decimal exponent or a ratio.** A decimal exponent (`10^n`) cannot say sixty
minutes to the hour or twelve to the dozen. Any fixed set of fractions fits one integer divisor — their
least common multiple (halves, thirds and quarters: 12; add fifths: 60) — so a rational multiplier is
needed only when the counting unit and the reading unit belong to different measurement systems
(grams read as troy ounces). That is two units, not one: pick one unit of account per tally (ounces,
grams or Goldbacks) and let the cross-denomination rate, which is already an exact rational
(`RateNum/RateDen`), carry the conversion between tallies.

**What a single divisor does not do.** It names one level of sub-unit, so `9h 05m 07s` (hours, minutes
and seconds at once) or pounds-shillings-pence cannot be written with it. That is a display question;
if such a unit is ever needed, the divisor becomes a list without changing how amounts are counted.

**Range.** `Units` are exact JavaScript integers, up to 2^53. A divisor fine enough to exhaust that
(Ethereum's wei is 10^18 per ETH: about 0.009 ETH fits) wants a coarser divisor (gwei, 10^9).

## The descriptor carries *meaning*, not just arithmetic

The three properties quantify **counting**. They do **not** capture what a unit *means*: `CHIP` is defined
by a value formula, a stablecoin pegs to something, a labor-hour means a kind of hour. That semantic
definition — and any peg — lives in the **descriptor document** the `cid:` designator points at, minimal by
design (`{ name, symbol, description, canonicalUnit }`). Both parties fetch it by CID **during
negotiation** to confirm they mean the same unit; the schema never fetches a CID at runtime. A unit's
human label is display-only, so label collisions are harmless.

So: **three properties + a descriptor** answer "can we represent virtually anything?" — **yes**: an integer
divisor counts it, and the descriptor carries its meaning/peg.

## Bilateral and fixed for life

The denomination is a **single shared value both parties sign** (one unit binds both sides of every chit),
so it sits on the bilaterally-signed `TallyContract`, never on a per-party row — unlike credit terms,
which each party grants unilaterally. It is locked on the first accepted contract: `DenominationImmutable`
ties every later revision's denomination and divisor to revision 1's. Renegotiation may change credit
terms; it may never change the unit. (Cross-denomination value movement is what lifts are for — see
[architecture.md § Cross-denomination conversion](architecture.md#cross-denomination-conversion).)

## Open questions

- Descriptor schema for a peg/definition richer than `canonicalUnit` (e.g. an oracle reference for a
  pegged unit) — deferred until a concrete pegged-unit use case appears.
