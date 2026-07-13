description: A tally's contract can now name the unit it is kept in — CHIPs, a national currency, or a custom unit — as a value both parties sign and cannot change for the tally's life.
prereq:
files: schema/draft1.qsql, docs/architecture.md
difficulty: medium
----
Implemented and reviewed `feat-denomination-argument`: the denomination (unit of account) + scale
travel as **bilaterally-signed contract arguments**, with a prefix-dispatch identifier scheme
(`CHIP` / `iso4217:<AAA>` / `cid:<address>`) and a life-of-tally immutability lock. All work is
schema + docs — no Taleus runtime exists yet (design phase).

## What landed

**`schema/draft1.qsql`:**

- **`ValidDenomination(id)`** — host-registered scalar check (same class as `ValidDate` /
  `SignatureValid` / `Digest`; referenced in-schema, defined by the runner). Prefix-dispatch contract
  spelled out in the comment block above `TallyContractProposal` (`schema/draft1.qsql:274`): three
  namespaces, no general parser, no currency-table lookup — `CHIP` (bare token), `iso4217:<AAA>`
  (three uppercase letters, shape-only), `cid:<address>` (non-empty content address).
- **`Denomination text default 'CHIP'` + `DenominationScale integer default 0 check (… >= 0)`** on
  **both** `TallyContractProposal` and `TallyContract`, each validated by `ValidDenomination` (so a
  malformed identifier is rejected at proposal *and* acceptance).
- **Bilateral coverage:** on `TallyContract` the denomination is a *single* shared column folded into
  **both** `StockSignatureValid` and `FoilSignatureValid` digests (and the proposal's single
  `SignatureValid` digest) — never a per-party row.
- **`DenominationImmutable`** on `TallyContract`: every revision after the first must match revision
  1's `Denomination` **and** `DenominationScale`. **Reviewer hardened this** (see findings).
- **CHIP degenerate default:** absent the argument, a tally is `CHIP` at scale 0 — a true regression
  (`Ledger` math is scale-independent; nothing in `Ledger` changed — confirmed in review).

**`docs/architecture.md`:** new **Denomination registry** subsection under § Denominations and
Exchange; `TallyContract` schema-table row and glossary updated. Verified coherent — no stale
"every tally is CHIPs" contradictions remain.

## Review findings

**Reviewed:** the full implement diff (`4e39451`), the two changed files read in full plus the
tables the change touches (`TallyContractProposal`, `TallyContract`, `Ledger`, `CreditTerms`,
`TradingVariable`), Quereus CHECK-constraint runtime semantics (sibling repo
`../quereus/.../runtime/emit/constraint-check.ts`), and `docs/architecture.md` § Denominations.

**Checked, clean:**

- **Bilateral placement** — denomination is one shared column covered by *both* stock and foil
  signature digests and the proposal digest. Correct design; not per-party. ✓
- **Proposal + acceptance validation** — `ValidDenomination` at both sites via one host fn (DRY). ✓
- **CHIP regression** — `Ledger` untouched, `Units` interpretation stays denomination-agnostic;
  scale-independence claim holds. ✓
- **Docs** — glossary, `TallyContract` table row, and new registry subsection all reflect the new
  reality; no contradictions. ✓

**Found + fixed inline (minor — correctness):**

- **`DenominationImmutable` passed instead of rejecting when revision 1 was absent.** A Quereus CHECK
  passes when its expression is NULL — only a definite FALSE rejects
  (`constraint-check.ts:373`, *"CHECK passes if truthy or NULL; fails otherwise"*). The original
  constraint compared `New.Denomination = (select … where Number = 1)`; with no revision-1 row that
  subquery is empty, the comparison is NULL, the whole `or` is NULL, and the constraint **accepted**
  an unanchored later revision carrying an arbitrary denomination — silently defeating the lock. This
  is reachable because `TallyContract` has no `Number`-monotonicity constraint, so a first insert at
  `Number > 1` is possible. The implement handoff asserted the opposite ("the subquery is null and
  the constraint *rejects*") — that was wrong. **Fix:** added an `exists (select 1 from TallyContract
  where Number = 1)` guard so the expression is a definite FALSE (reject) whenever revision 1 does not
  exist. Side benefit: any `Number > 1` insert now requires revision 1 to be present. Comment at the
  site documents why the guard is load-bearing.

**Considered, not actioned (with reasons — not silently dropped):**

- **`Denomination`/`DenominationScale` lack `NOT NULL`,** so an explicit `null` insert bypasses the
  `>= 0` check (NULL passes) and the immutability comparison. **Not fixed, not filed:** *no* column in
  the entire schema uses `not null` — every column is default-only (chits, signatures, credit terms
  included). This is a deliberate schema-wide posture, not a denomination-specific defect; singling
  out these two columns would be inconsistent. Belongs to a future schema-wide NOT-NULL hardening
  pass, not this ticket.
- **`TallyContract` has no `Number`-monotonicity / no-gap constraint** (pre-existing — `Number` is
  only the PK; the implement handoff flagged it). Out of scope here. The inline fix above now at least
  guarantees revision 1 exists before any later revision on the denomination path.
- **No proposal↔contract denomination cross-check** — by design. The proposal is a mutable
  negotiation cursor; the app accepts a contract matching the agreed proposal, exactly as credit-terms
  revisions are handled. Confirmed intended boundary. ✓

**Major findings:** none — no new fix/plan/backlog tickets filed.

## Tripwires (conditional concerns — recorded, not tickets)

- **Descriptor fetch is negotiation-time, not a schema constraint.** A `cid:` unit's meaning is
  confirmed by both parties fetching the descriptor during negotiation; an unfetchable/disagreed
  descriptor fails negotiation at the app layer. Deliberately no runtime CHECK fetches a CID —
  recorded as prose in the `ValidDenomination` comment block and the docs' Denomination registry
  subsection. (Carried over from implement; confirmed correct in review.)

## Not runnable yet (design-phase posture, unchanged)

No `package.json` / schema runner in the Taleus tree — the `.qsql` schema is not executable, and
`ValidDenomination` / `TallyCore` are undefined in-tree (`TallyCore` tracked by
`backlog/debt-schema-tallycore-table`). No lint or tests to run; same posture as the
`feat-schema-credit-terms` / `feat-exchange-rate-quotes` reviews. The use-case suite documented in
the implement handoff (CHIP regression, `iso4217:USD` scale 2, immutability reject, invalid-identifier
rejection at proposal + acceptance, negative-scale reject, bilateral placement) becomes executable
when a runner + the `ValidDenomination` host function exist.
