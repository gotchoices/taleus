description: A tally's contract can now name the unit it is kept in — CHIPs, a national currency, or a custom unit — as a value both parties sign and cannot change for the tally's life. Review the schema and docs that add it.
prereq:
files: schema/draft1.qsql, docs/architecture.md
difficulty: medium
----
Implemented `feat-denomination-argument`: the denomination (unit of account) + scale now travel as
**bilaterally-signed contract arguments**, with a prefix-dispatch identifier scheme and a
life-of-tally immutability lock. All work is schema + docs — no Taleus runtime code exists yet.

## What landed

**`schema/draft1.qsql`:**

- **`ValidDenomination(id)`** — documented as a host-registered scalar check (same class as the
  existing `ValidDate` / `SignatureValid` / `Digest`; referenced in-schema, defined by the runner).
  Its exact contract is spelled out in a comment block above `TallyContractProposal`
  (`schema/draft1.qsql:274`): three namespaces dispatched by prefix, **no** general parser, **no**
  currency-table lookup —
  - `CHIP` (reserved bare token),
  - `iso4217:<AAA>` (three **uppercase** letters, shape-only — not table-checked),
  - `cid:<address>` (non-empty content address).
- **`Denomination text default 'CHIP'` + `DenominationScale integer default 0 check (… >= 0)`** added
  to **both** `TallyContractProposal` and `TallyContract`, validated by `ValidDenomination` at each
  (so a malformed identifier is rejected at proposal *and* acceptance).
- **Bilateral coverage:** on `TallyContract` the denomination is a *single* shared column folded into
  **both** `StockSignatureValid` and `FoilSignatureValid` digests (and into the proposal's single
  `SignatureValid` digest) — never a per-party row.
- **`DenominationImmutable`** constraint on `TallyContract` (`schema/draft1.qsql:371`): every revision
  after the first must match revision 1's `Denomination` **and** `DenominationScale`, so a later
  contract revision changing the unit or scale is rejected.
- **CHIP degenerate default:** absent the argument, a tally is `CHIP` at scale 0 — a true regression
  (Ledger math is scale-independent, nothing in `Ledger` changed).

**`docs/architecture.md`:** new **Denomination registry** subsection under § Denominations and
Exchange (the three namespaces, scale exponent, descriptor document, immutability, CHIP default);
`TallyContract` schema-table row updated to mention the denomination argument.

## How to exercise it (test floor — none are runnable yet; see gaps)

These are the use cases the schema is written to satisfy; they become executable only when a
Taleus schema runner + the `ValidDenomination` host function exist.

- **CHIP regression (must be exact).** Insert a `TallyContract` with no denomination argument →
  `Denomination = 'CHIP'`, `DenominationScale = 0`; both signature digests cover `'CHIP', 0`; every
  `Ledger` insert/balance behaves identically to before this ticket.
- **`iso4217:USD` scale 2 accepted.** Contract with `Denomination = 'iso4217:USD'`,
  `DenominationScale = 2` accepted; a `Ledger.Units` value of 100 means 1.00 USD (Units are cents).
- **Immutability.** A second `TallyContract` (Number = 2) whose `Denomination` **or**
  `DenominationScale` differs from revision 1's → rejected by `DenominationImmutable`. A revision-2
  that *matches* revision 1 is accepted (and may still change the credit-terms references).
- **Invalid identifiers rejected at proposal AND acceptance:** `usd`, `iso4217:US`, `iso4217:usd`,
  `iso4217:USDX`, empty `cid:`, bare `cid` (no colon). Valid: `CHIP`, `iso4217:USD`, `iso4217:EUR`,
  `cid:<any-non-empty>`.
- **Negative scale rejected** (`DenominationScale >= 0`).
- **Bilateral placement.** Confirm the denomination is *one* column covered by both stock and foil
  signatures — a per-party (single-signer) placement would be the wrong design.

## Known gaps / honest flags for the reviewer

- **`ValidDenomination` is not implemented in-tree.** It is referenced as a host scalar exactly like
  `ValidDate`, with its semantics documented at the definition site — but no runner registers it yet,
  so the check is unresolvable today. This is the *whole schema's* posture (design phase), not a
  regression; the reviewer should sanity-check the documented prefix-dispatch contract, since that
  comment is the only spec the eventual host implementation will follow. **Open choice the reviewer
  may want to weigh:** host function vs. inline `like`/`glob`/`substr` CHECK. I chose the host
  function for DRY (two call sites) and consistency with `ValidDate`; an inline CHECK would be
  self-contained/reviewable but duplicated and dependent on Quereus supporting `glob`/`substr` in a
  CHECK. Either is within the ticket's stated latitude.
- **No runnable tests.** No `package.json` / schema runner in the Taleus tree (only `tess/` tooling).
  Same posture as the `feat-schema-credit-terms` / `feat-exchange-rate-quotes` reviews. The use cases
  above are the specified suite to land when a runner exists.
- **`TallyCore` is still undefined** across the whole schema (pre-existing, tracked
  `backlog/debt-schema-tallycore-table`) — the blocker for executing any of this. Not this ticket's
  scope.
- **No proposal↔contract cross-check by design.** The schema does not tie `TallyContract.Denomination`
  to the last `TallyContractProposal.Denomination` — the proposal is a mutable negotiation cursor;
  the app is responsible for accepting a contract that matches the agreed proposal. Flagging so the
  reviewer confirms that's the intended boundary (I believe it is — matches how credit-terms
  revisions are handled).
- **`DenominationImmutable` reads `Number = 1` with a plain ref, and `TallyContract` has no
  `Number`-monotonicity constraint** (pre-existing — `Number` is only the PK). The plain ref is safe
  because the `Number = 1` filter excludes the row being inserted (its `Number > 1`); if revision 1
  is somehow absent the subquery is null and the constraint *rejects* a later revision, which is a
  reasonable failure mode. Reviewer should confirm they're comfortable anchoring to revision 1 rather
  than the immediately-prior revision (ticket specifies revision 1).

## Tripwires recorded (not tickets)

- **Descriptor fetch is negotiation-time, not a schema constraint.** A `cid:` unit's meaning is
  confirmed by both parties fetching the descriptor during negotiation; an unfetchable/ disagreed
  descriptor fails negotiation at the app layer. Deliberately *no* runtime CHECK fetches a CID —
  recorded as prose in the `ValidDenomination` comment block and the docs' Denomination registry
  subsection (architectural concern, no single code site). Do not file as a ticket.
