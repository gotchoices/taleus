----
description: Review the new private exchange-rate quote table and the whole-number math that converts value between denominations during a payment or lift.
prereq:
files: schema/portfolio.qsql, docs/architecture.md
difficulty: hard
----
Implement handoff for `feat-exchange-rate-quotes`. Second of two chained tickets from the `feat-multi-denomination` plan (after `feat-denomination-argument`). This ticket defines the private `ExchangeRateQuote` structure and the exact integer conversion + rounding math the lift agent will apply; `feat-chipnet-integration` consumes both.

## What was delivered

- **`schema/portfolio.qsql`** — replaced the `feat-exchange-rate-quotes` placeholder comment with:
  - `ExchangeRateQuote` table (insert-only, revisioned, unsigned — strand membership is the sole write gate, same as every other portfolio table). Columns: `FromDenom`, `ToDenom`, `Revision`, `RateNum`, `RateDen`, `MidNum` (null), `MidDen` (null), `SpreadPpm` (null), `ValidFrom`, `ValidUntil`, `Updated`. PK `(FromDenom, ToDenom, Revision)`.
  - Guards: inline `check (RateNum > 0)`, `check (RateDen > 0)`; named `ValidWindow check (ValidUntil >= ValidFrom) on insert`; `RevisionMonotonicInt` using `from committed.ExchangeRateQuote` matched on the `(FromDenom, ToDenom)` pair; `InsertOnly`.
  - `CurrentExchangeRateQuote` latest-wins view (max `Revision` per direction), mirroring `CurrentPreference`.
  - Three `NOTE:` comment blocks at the rate definition: the `req_in` conversion formula, the BigInt/lowest-terms **overflow strategy** (decided), and the **rounding-dust accumulation** tripwire.
- **`docs/architecture.md`** § Denominations and Exchange — two new subsections: *Exchange rate quotes* (private-vs-published distinction from `TradingVariable`, directional two-row spread, display-level scale independence, guards) and *Cross-denomination conversion* (backward-walk formula, degenerate no-op case, fee composition via `LiftLading`, who-absorbs-the-dust rule, overflow decision, missing/expired-quote pruning).

## Key design decisions (verify these)

- **`Updated text` column added beyond the ticket's structure block.** The ticket spec listed no write-time timestamp, but every sibling portfolio table (`TallyRegistry`, `LiftJournal`, `AppPreference`) carries `Updated`. Added for house-style consistency; distinct from the quote's own business window (`ValidFrom`/`ValidUntil`). Flagging because it deviates from the literal spec — reviewer's call whether to keep.
- **Column order = house style, not spec order.** Ticket's structure block put `Revision` last; the schema uses key-columns-then-`Revision`-then-data (matches `TallyRegistry`/`AppPreference`). Intentional.
- **`committed.` prefix in `RevisionMonotonicInt`.** Follows the corrected portfolio-state form (a plain self-ref reads the buffered in-flight row and makes `Revision = max+1` unsatisfiable). Draft1's `TradingVariable` uses the buggy plain form; this table does not.
- **Validity filtering is NOT in the view.** `CurrentExchangeRateQuote` returns the latest revision per direction; the lift agent applies `ValidFrom <= now <= ValidUntil` at decision time (the view has no "now"). A pair whose latest revision is out of window has no usable quote → boundary pruned. This is the "missing/expired quote prunes the route" rule.

## The conversion math to review

At each boundary (downstream `D_out`/`s_out`/`req_out`, upstream `D_in`/`s_in`, intermediary quotes `RateNum/RateDen` for `From=D_in, To=D_out`):

```
req_in = ceil( req_out * RateNum * 10^(s_in)  /  ( RateDen * 10^(s_out) ) )
```

Round up (downstream never shorted); sub-unit remainder borne upstream, cascading to the originator (payer for linear lift/payment, initiator for circular clearing lift). Commit binds each edge's ceiled integer units in that edge's own denomination.

## Use cases / test floor (specified, NOT yet landed — see gaps)

These are the tests the ticket specifies up front; they land with the conversion helper under `feat-chipnet-integration`:

- **Degenerate single-denomination lift** — all rates 1, equal scales → ceil is a no-op, `req` unchanged edge to edge, originator cost == payee amount. Regression against current MyCHIPs behavior.
- **Two-denomination payment** — payee wants `A` USD-cents; payer's exact CHIP source cost == the `req_in` ceil formula.
- **Three-denomination chain** (e.g. CHIP → USD → labor-hours) — accumulated conversion product exact, tested in **both** directions (From/To semantics + backward walk).
- **Missing / expired quote** at a boundary → route pruned; agent never fabricates a rate.
- **Rounding dust** — borne by the originator; every intermediary and the payee net ≥ 0.
- **Circular clearing lift across denominations** (3-node) — net-zero in value, initiator carries the loop's rounding dust; every intermediary nets ≥ 0.
- **Overflow bound** honored for large amounts × large scales — exercises the BigInt/lowest-terms path.

## Known gaps / honest limitations

- **No schema execution, no tests run.** There is still no Taleus schema runner or build scaffolding (design phase; only the unrelated `tess/` tooling is in-tree — confirmed same posture as the `feat-portfolio-state` review). `schema/portfolio.qsql` was written for structural consistency with draft1/portfolio patterns, **not executed**. The test floor above is a floor, not a completed suite — treat it as such.
- **No conversion code exists yet.** The `req_in` helper and lift-agent integration land under `feat-chipnet-integration`. Because there is no code site, the conversion NOTEs (formula, overflow strategy, dust tripwire) live at the `ExchangeRateQuote` definition in the schema — the current canonical home. The NOTEs explicitly instruct the future author to carry them to the real `req_in` computation site. **Verify that instruction is clear enough that the overflow decision survives the handoff to `feat-chipnet-integration`.**
- **Date comparison is lexicographic.** `ValidWindow` and the agent's decision-time window filter both compare `ValidFrom`/`ValidUntil` as text — correct only for ISO-8601 (`YYYY-MM-DD`) dates. Nothing enforces the format; the ticket specified `text` date columns and did not ask for a format guard. Flag if the reviewer wants one, but it is out of this ticket's stated scope.
- **`SpreadPpm`/`Mid*` unread.** Optional display fields; no code reads them yet (same forward-looking posture as `PortfolioCore.Version`).

## Tripwires (recorded at the site — index only)

- `schema/portfolio.qsql`, at the conversion `NOTE:` block — **rounding-dust accumulation**: a route of N boundaries adds up to N sub-units of extra originator cost. Bounded/acceptable now; revisit redistribution only if very long routes appear.
- `schema/portfolio.qsql`, same block — **overflow strategy** is stated as a decision (BigInt + lowest-terms) so a future reader does not regress it to a native 64-bit multiply. Not conditional — it is the required implementation contract; parked as a NOTE because the code site does not exist yet.
