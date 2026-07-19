# Denominations — Quantifying a Unit of Account

A core Taleus generalization over MyCHIPs: a tally is kept in **any** unit of account its contract
names, not only CHIPs. This doc is the *quantification model* — how a unit is named and how amounts are
counted. The runtime mechanics (conversion formula, overflow rule, discovery) live in
[architecture.md § Denominations and Exchange](architecture.md#denominations-and-exchange); this doc is
the conceptual companion and records the open **multiplier** decision.

## Three properties quantify a unit

Any unit of account is captured by three properties. Taleus's schema realizes them as
`TallyContract.Denomination`, `Ledger.Units`, and `TallyContract.DenominationScale`.

| Property | What it is | Schema today |
|---|---|---|
| **Designator** | Which unit (USD, CHIP, BTC, a custom unit) | `Denomination` — a namespaced identifier |
| **Sub-units** | Integer count of the smallest unit the tally transacts in (cents, milliCHIPs, satoshis) | `Ledger.Units` (integer ≥ 1) |
| **Multiplier** | The relationship between the display unit and the sub-unit | `DenominationScale` (a **decimal exponent**) |

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

## Multiplier: decimal scale today, rational tomorrow (open decision)

`DenominationScale` is a **decimal exponent**: one `Units` integer = `10^(−Scale)` of the display unit.
`iso4217:USD` scale 2 → each `Units` is a cent; `CHIP` scale 3 → a milliCHIP. Scale is authoritative (for
`iso4217:` it is *not* cross-checked against a currency table — the contract wins). Default `CHIP` scale 0
reproduces today's implicit single-denomination behavior exactly.

**The limit:** a decimal exponent can only express **powers of ten**. It cannot express a non-decimal
subdivision — pounds/ounces, hours/minutes, a dozen. For "represent virtually *anything*," the multiplier
must be allowed to be a **rational** (numerator/denominator), not only `10^n`.

Two ways to get full generality, both viable:

1. **Always denominate in the smallest indivisible unit** (ounces, minutes, eggs) and treat display
   formatting as an app concern. Decimal `Scale` then serves display only. Covers nearly all money and
   most commodities with the schema as-is.
2. **Allow a rational multiplier.** The machinery already exists — cross-denomination conversion uses a
   rational `RateNum/RateDen` — so letting a unit's *own* multiplier be rational is a small, consistent
   extension. Natural home: the `cid:` **descriptor's `canonicalUnit`** field, so mainstream decimal units
   keep the fast `Scale` path and only genuinely non-decimal units carry a rational.

**Recommendation:** keep integer sub-units always; keep decimal `Scale` as the common fast path; carry a
rational multiplier in the descriptor for non-decimal units. *Not yet decided* — captured here and in
[STATUS.md](STATUS.md).

## The descriptor carries *meaning*, not just arithmetic

The three properties quantify **counting**. They do **not** capture what a unit *means*: `CHIP` is defined
by a value formula, a stablecoin pegs to something, a labor-hour means a kind of hour. That semantic
definition — and any peg — lives in the **descriptor document** the `cid:` designator points at, minimal by
design (`{ name, symbol, description, canonicalUnit }`). Both parties fetch it by CID **during
negotiation** to confirm they mean the same unit; the schema never fetches a CID at runtime. A unit's
human label is display-only, so label collisions are harmless.

So: **three properties + a descriptor** answer "can we represent virtually anything?" — **yes**, provided
(a) the multiplier may be rational and (b) the descriptor carries the unit's meaning/peg.

## Bilateral and fixed for life

The denomination is a **single shared value both parties sign** (one unit binds both sides of every chit),
so it sits on the bilaterally-signed `TallyContract`, never on a per-party row — unlike credit terms,
which each party grants unilaterally. It is locked on the first accepted contract: `DenominationImmutable`
ties every later revision's denomination and scale to revision 1's. Renegotiation may change credit terms;
it may never change the unit. (Cross-denomination value movement is what lifts are for — see
[architecture.md § Cross-denomination conversion](architecture.md#cross-denomination-conversion).)

## Open questions

- **Rational vs. decimal multiplier** (above) — decide whether to extend beyond `10^n`, and if so, put the
  rational in the descriptor's `canonicalUnit`. Tracked in [STATUS.md](STATUS.md).
- Descriptor schema for a peg/definition richer than `canonicalUnit` (e.g. an oracle reference for a
  pegged unit) — deferred until a concrete pegged-unit use case appears.
