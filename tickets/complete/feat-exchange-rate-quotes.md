description: Reviewed the new private exchange-rate quote table and the whole-number conversion math that moves value between denominations during a payment or lift.
prereq:
files: schema/portfolio.qsql, docs/architecture.md
----
Completed review of `feat-exchange-rate-quotes` (second of two chained tickets from the `feat-multi-denomination` plan). The implement stage delivered the private `ExchangeRateQuote` table + `CurrentExchangeRateQuote` view in `schema/portfolio.qsql`, the exact integer `req_in` conversion/rounding formula (as `NOTE:` comments at the rate definition — no conversion code site exists yet), and two new subsections in `docs/architecture.md` § Denominations and Exchange. `feat-chipnet-integration` (in `plan/`) consumes both.

## Review findings

### Correctness — one defect found and fixed inline

- **`FromDenom`/`ToDenom` column comments were inverted** (`schema/portfolio.qsql`, the two key columns of `ExchangeRateQuote`). The gloss read "`FromDenom` = denomination the quoting party **releases (pays out)**" / "`ToDenom` = **accumulates (receives)**". That is backwards relative to the conversion formula three lines of context away, which reads the quote row as `From = D_in, To = D_out` where `D_in` is the upstream (payer-side) edge and `D_out` the downstream (payee-side) edge. At an intermediary M value flows payer→payee: M **receives** on the `D_in` edge and **pays out** on the `D_out` edge — so `FromDenom = D_in` is the denomination M *receives*, and `ToDenom = D_out` is what M *releases*. Verified with a worked example (1 CHIP = 2 USD, `D_in`=USD, `D_out`=CHIP → row `From=USD,To=CHIP`, `RateNum/RateDen`=2 USD-per-CHIP; M receives USD, pays CHIP — `FromDenom`=USD is received, not released). The formula, the `RateNum` comment ("FromDisplay per ToDisplay"), and `docs/architecture.md` were all mutually consistent and economically correct; only the two-word column gloss was wrong. The error was inherited verbatim from the implement ticket's structure block. **Disposition: minor, fixed inline** — corrected both comments to tie `FromDenom`→`D_in` (received) and `ToDenom`→`D_out` (released), referencing the conversion `NOTE:` below them. This mattered because `feat-chipnet-integration` populates and reads rows by these column semantics; a party trusting the old gloss would have stored quotes keyed opposite to how the formula reads them, applying the wrong-direction (asymmetric) spread.

### Conversion math — verified correct

- Formula `req_in = ceil( req_out * RateNum * 10^(s_in) / ( RateDen * 10^(s_out) ) )` is dimensionally and economically sound (checked against the 2-USD-per-CHIP example above and the degenerate `RateNum=RateDen=1, s_in=s_out` no-op case). Round-up-so-downstream-never-shorted, dust-to-originator, and the BigInt/lowest-terms overflow strategy are all coherent and match the docs.

### Schema patterns — verified consistent, no findings

- `RevisionMonotonicInt` correctly uses the `committed.ExchangeRateQuote` prefix (matches the corrected portfolio-state form in `TallyRegistry`/`LiftJournal`/`AppPreference`; avoids the buffered-row bug that `draft1.qsql`'s `TradingVariable` still carries). Composite `(FromDenom, ToDenom)` match against the `(FromDenom, ToDenom, Revision)` PK is correct.
- `CurrentExchangeRateQuote` latest-wins view mirrors `CurrentPreference`; validity-window filtering is intentionally left to the agent at decision time (the view has no "now"), so a pair whose latest revision is out-of-window has no usable quote and the boundary prunes — matches the documented "missing/expired quote prunes the route" rule.
- `InsertOnly`, `RateNum > 0`, `RateDen > 0`, `ValidWindow (ValidUntil >= ValidFrom)`, and the `Updated` house-style column are all consistent with sibling tables. `Updated`, column ordering, and the `committed.` prefix (all flagged in the handoff for reviewer confirmation) are accepted as-is — they match house style.

### Docs — verified against the schema, accurate

- Both new `docs/architecture.md` subsections (*Exchange rate quotes*, *Cross-denomination conversion*) reflect the delivered schema and formula. The docs never restated the inverted "releases/receives" gloss — they use only the `From=D_in,To=D_out` framing, which is correct — so no doc edit was needed for the fix above.

### Tests / lint — none runnable (stated, with reason)

- **No test or lint run.** Confirmed there is no `package.json`, no Taleus schema runner, and no build scaffolding in-tree (design phase; only the unrelated `tess/` tooling exists) — identical posture to the `feat-portfolio-state` review. `schema/portfolio.qsql` is written for structural consistency, not executed. The 7-case test floor in the handoff (degenerate single-denom, two-denom payment, three-denom chain both directions, missing/expired quote, rounding dust, circular clearing lift, overflow bound) remains a *specified floor*, not a landed suite — it lands with the conversion helper under `feat-chipnet-integration`. No pre-existing failures to report (`.pre-existing-known.md` empty).

### Tripwires — verified in place at the site (index only, per rules)

- `schema/portfolio.qsql`, conversion `NOTE:` block — **rounding-dust accumulation**: N boundaries add up to N sub-units of extra originator cost; bounded/acceptable, revisit only if very long routes appear. Recorded at the site; not re-filed as a ticket.
- `schema/portfolio.qsql`, same block — **overflow strategy** (BigInt + lowest-terms) recorded as a decision so a future author does not regress it to a native 64-bit multiply. Not conditional — it is the required implementation contract, parked as a `NOTE:` because the `req_in` code site does not exist yet; the `NOTE:` instructs the `feat-chipnet-integration` author to carry it to that site. Instruction verified clear.

### Out of scope — noted, not actioned (with reason)

- **Lexicographic date comparison.** `ValidWindow` and the agent's decision-time window filter compare `ValidFrom`/`ValidUntil` as `text`; correct only for ISO-8601 (`YYYY-MM-DD`) and nothing enforces the format. The ticket specified `text` date columns and no format guard, and every sibling portfolio table uses text timestamps the same way — so this is consistent with the codebase and out of this ticket's stated scope. Not a defect to fix here; flagged so a future format-guard decision (if wanted) is made deliberately, not by omission.
- **`Mid*`/`SpreadPpm` and `FromDenom = ToDenom` self-quotes** are unread by any code yet (forward-looking, like `PortfolioCore.Version`). No relational guard tying `MidNum`/`MidDen` together and no anti-self-quote guard — both harmless now (a same-denomination boundary needs no conversion, so a self-quote is never read). Left as-is; not worth a ticket.

## No new tickets spawned

The single finding was a minor inline comment fix. No major findings warranting a `fix/`/`plan/`/`backlog/` ticket, and no human-decision blockers.
