description: Added the credit-terms schema — per-party signed limit/notice table, contract reference that locks it, and the ledger gate that refuses chits exceeding the limit in force. Reviewed and completed.
prereq:
files: schema/draft1.qsql, docs/architecture.md, docs/old/tally.md
----
Delivered `feat-schema-credit-terms`: a unilateral, revisioned `CreditTerms` table
(per-grantor limit + notice period), the `TallyContract`/`TallyContractProposal` reference
that folds each party's operative revision into the bilateral signatures, and the
`Ledger.WithinCreditLimits` gate that rejects any chit whose resulting balance exceeds the
credit effective as of the chit's date. Advisory `CurrentCreditLimit` view + `LiftLading`
cap round it out. All work in `schema/draft1.qsql` and `docs/architecture.md`. See the
implement commit (`git log --grep="ticket(implement): feat-schema-credit-terms"`) for the
full build description.

## Review findings

**Scope checked:** the full implement diff read first with fresh eyes, then the handoff.
Scrutinized `CreditTerms` constraints (revision monotonicity, signature coverage, notice
rule), the `WithinCreditLimits` gate math and effective-limit selection, `LiftLading` cap
arithmetic, `TallyContract`/`Proposal` signature-digest changes and existence constraints,
and every doc line the change touched or should have. Compared against sibling tables
(`TradingVariable`, `PartyKey`, `PartyCertificate`) for consistency.

**Verified correct (no action):**
- **`WithinCreditLimits` balance orientation** — stock-granted limit caps positive balance
  (foil's debt to stock), foil-granted caps negative (stock's debt to foil). Correct.
- **Effective-limit selection (max-revision-among-effective).** Walked the tricky cases:
  future-dated restrictive revision coexisting with a later immediate permissive; permissive
  raise superseding a not-yet-effective restriction; a restriction becoming effective and
  taking over once its `EffectiveDate` arrives. `EffectiveDate` gating already excludes
  not-yet-in-force restrictions, and revisions are monotonic, so highest effective revision
  always wins correctly. Sound.
- **`EffectiveDateValid` notice rule** — restrictive = `CreditLimit` OR `CallDays` decreases,
  compared to the immediately-prior committed revision; permissive/rev-1 immediate; boundary
  `EffectiveDate = Date + prior.CallDays` allowed (`>=`); shortening `CallDays` correctly
  treated as restrictive. Correct.
- **`LiftLading` cap math** — `Cap = min(Bound, receiver CreditLimit)`; checked the three
  regimes (`CreditLimit` below `Target`, between `Target` and `Bound`, above `Bound`). Free
  portion clamps to `CreditLimit`, rewarded clamps to 0 when `CreditLimit < Target`,
  no accumulation past an already-exceeded lowered limit. Sound.
- **Signature coverage** — both `TallyContract` signatures and the proposal signature fold in
  the referenced credit-terms revisions; `StockTermsExist`/`FoilTermsExist` force those
  revisions to exist on the load-bearing `TallyContract`. Formation cannot form a contract
  without both parties having published `CreditTerms`, matching the docs. Consistent.

**Major — filed as new ticket:**
- **Chit backdating evades the credit gate / restrictive-change notice.**
  `WithinCreditLimits` selects the effective limit by the **issuer-signed chit `Date`**,
  which is unconstrained (no `Date`↔`Number` monotonicity on `Ledger`), and chits are
  unilateral (issuer-signed only — this CHECK is the sole enforcement, no counterparty
  countersignature). An issuer can date a chit before a restrictive reduction took effect,
  select the older higher limit, and exceed the limit now in force. This is stronger than the
  grantor-backdate caveat the implementer already recorded (that one is disputable via the
  observed terms date; this one the victim cannot reject at signature time). Determinism vs.
  safety is a genuine design tradeoff → filed `backlog/debt-credit-gate-chit-date-backdating`
  with the options (bound `Date`, gate on `now()`, `Date`-monotonic-with-`Number`, or accept).
  A `NOTE:` at the `WithinCreditLimits` site points to it.

**Minor — fixed inline this pass:**
- **Stale doc line.** `docs/architecture.md` § Core Concepts *Contract* still said contract
  arguments "carry the denomination and each party's credit terms," contradicting the new
  *Credit terms* bullet (terms are unilateral, referenced by revision, not contract columns).
  Rewrote it to "denomination and a reference to each party's operative credit-terms revision."

**Tripwires (left as recorded by the implementer — confirmed appropriately conditional, not
demoted defects):**
- `CreditTerms.RevisionMonotonicInt` `committed.*`-vs-plain-ref inconsistency with sibling
  `TradingVariable`/`PartyCertificate` — genuinely conditional on the Quereus deferral model,
  resolvable only when a runner exists; `NOTE:` at the site.
- `CreditTerms` backdated-terms-`Date` trust caveat — inherent to a unilateral grantor-signed
  timestamp, disputable via the replicated signed `Date`; `NOTE:` at the table.
- `CurrentCreditLimit` uses volatile `julianday('now')` in a plain view — fine there, flagged
  as not-allowed-in-a-MATERIALIZED-view; `NOTE:` at the view.

**Lint / tests — not run, none exist.** No `package.json`, no Taleus schema runner, no build
scaffolding in-tree (design phase — same posture as the `feat-portfolio-state` /
`feat-exchange-rate-quotes` reviews). The schema is written for structural consistency with
its siblings, not executed. `tickets/.pre-existing-known.md` absent; no pre-existing failures
to report. The implement handoff's test/use-case floor stands as the specified suite to land
when a runner exists — reviewed for coverage; it should add an explicit case for the chit-
backdating gap above once that ticket's decision lands.

**Not built here (carried forward, unchanged from handoff):** `TallyCore` is still undefined
across the whole schema (tracked `backlog/debt-schema-tallycore-table`) — the blocker for ever
executing any of this; the pending-lift `Ledger` state (`feat-chipnet-integration`) still
carries its own TODO and must, when it lands, confirm a pending chit's balance contribution is
counted and a voided lift unwinds it. Both are pre-existing scope, not regressions from this
ticket.
