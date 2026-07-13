----
description: Let a tally's contract name what unit it is kept in — CHIPs, a national currency, or a custom unit — and lock that choice for the tally's life.
prereq: feat-schema-credit-terms
files: schema/draft1.qsql, docs/architecture.md
difficulty: medium
----
Background: `docs/architecture.md` § Denominations and Exchange. A tally's denomination is the unit of account it is kept in. Today every tally is implicitly CHIPs. This ticket adds the denomination + scale as a contract argument, plus the identifier scheme (the "registry") that both parties and routing agents use to agree on what a denomination *means*.

This is the first of two chained tickets from the `feat-multi-denomination` plan. The second, `feat-exchange-rate-quotes`, defines the private rate quotes and the cross-denomination conversion math; it depends on this one for the denomination identifiers.

## Denomination identifier scheme (the registry)

An identifier is a namespaced string. Three namespaces, dispatched by prefix — no general parser:

- `CHIP` — the network reference unit (reserved bare token, no prefix).
- `iso4217:<AAA>` — national currencies, `<AAA>` a three-letter ISO 4217 code (`USD`, `EUR`, …).
- `cid:<contentaddress>` — custom / open-ended units, identified by the content address (CID) of a **denomination descriptor** document.

**Collision handling for custom units is by construction:** content-addressing makes a `cid:` identifier globally unique — two parties who reference the same descriptor reference the same CID, and two different descriptors cannot collide. A human-readable label lives *inside* the descriptor and is display-only, so label collisions are harmless.

Descriptor document (for `cid:` units), minimal: `{ name, symbol, description, canonicalUnit }`. Stored content-addressed (Optimystic). Both parties fetch it by CID during **negotiation** to confirm they mean the same unit; if either cannot fetch or does not agree, the tally negotiation fails. This is a negotiation-time concern, not a runtime lift constraint.

Validation: a `ValidDenomination(id)` check (helper function or inline CHECK) that (a) accepts the bare token `CHIP`, (b) accepts `iso4217:` + three uppercase letters, (c) accepts `cid:` + a non-empty address. Prefix dispatch only — do not build a currency-table lookup or a heavy parser.

## Scale

Scale is a decimal exponent: one `Ledger.Units` integer equals 10^(−scale) of the denomination's display unit. `iso4217:USD` at scale 2 → smallest unit is one cent; `CHIP` at scale 3 → one milliCHIP. The contract states scale explicitly (integer ≥ 0). For `iso4217:` it *may* default to the currency's canonical minor-unit exponent, but the contract's stated value is authoritative — do not cross-check it against a currency table.

## Contract argument

The denomination identifier + scale travel as contract arguments via the mechanism `feat-schema-credit-terms` establishes (structured columns on the contract-acceptance row, or the `CreditTerms` table it introduces — whichever that ticket lands). Attach `Denomination` (text) and `DenominationScale` (integer) there.

Two properties distinguish the denomination argument from credit terms:

- **Bilateral, not unilateral.** Credit terms are each granted by one party (only the grantor signs). The denomination is a single shared value both parties sign — a chit is one denomination for *both* sides of the tally. It must sit on the bilaterally-signed contract, never on a per-party row.
- **Fixed for the tally's life.** The denomination + scale set on the tally's first accepted contract cannot change on any later contract revision. Renegotiation may change credit terms; it may never change the unit.

Degenerate default: absent an explicit argument, a tally is `CHIP` at the contract's default scale — preserving today's single-denomination behavior with zero ceremony.

## Edge cases & interactions

- **Immutability across contract revisions.** A revision-2 contract naming a different denomination or scale than revision 1 must be rejected. Constraint ties every later `TallyContract` revision's denomination/scale to revision 1's.
- **Bilateral placement.** The argument must be covered by both signatures. A design that places it on a per-party (unilateral) row is wrong — verify a single denomination binds both stock and foil.
- **Invalid identifier** (`usd`, `iso4217:US`, `iso4217:usd`, empty `cid:`) rejected at proposal/acceptance.
- **Custom descriptor unfetchable** by the counterparty → negotiation-time failure surfaced to the app; not a schema constraint (do not add a runtime CHECK that fetches a CID).
- **iso4217 default-scale vs explicit-scale mismatch** is allowed — the contract value wins, no currency-table cross-check.
- **CHIP degenerate default** must be a true regression: a tally created with no denomination argument behaves exactly as today, all `Ledger` math unchanged.

## TODO

- Add `ValidDenomination` (helper fn or inline CHECK) covering the three namespaces by prefix dispatch.
- Add `Denomination` (text) + `DenominationScale` (integer ≥ 0) to the contract-argument representation from `feat-schema-credit-terms`, on the bilaterally-signed row.
- Add the immutability constraint tying later contract revisions' denomination/scale to revision 1.
- Default denomination to `CHIP` when the argument is absent.
- Update `docs/architecture.md` § Denominations and Exchange: add a **Denomination registry** subsection covering the three namespaces, the scale exponent, the descriptor document, and the immutability rule.
- Tests:
  - single-denomination CHIP tally == current behavior (regression; ledger math untouched).
  - `iso4217:USD` scale 2 accepted; a tally's `Units` are interpreted as cents.
  - a later contract revision changing the denomination or scale is rejected.
  - invalid identifiers (`usd`, `iso4217:US`, empty `cid:`) rejected at proposal/acceptance.
