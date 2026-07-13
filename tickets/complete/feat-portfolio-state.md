description: Reviewed the private per-user portfolio store — a single-owner Sereus strand holding a party's tally list, exchange rates, in-flight lift bookkeeping, and app settings — and its new schema file.
prereq:
files: schema/portfolio.qsql, docs/architecture.md, schema/draft1.qsql, tickets/backlog/feat-portfolio-app-wiring.md
----
Completed review of `feat-portfolio-state`. Implement diff = commit `fb4222d` (`schema/portfolio.qsql` new, `docs/architecture.md` refined + new `## Portfolio` section).

## What was delivered

- `schema/portfolio.qsql` — single-party portfolio strand: `PortfolioCore` (singleton marker), `TallyRegistry`, `LiftJournal`, `AppPreference` + three latest-wins views. Insert-only, revisioned, unsigned (strand membership is the write gate). `ExchangeRateQuote` deferred to `feat-exchange-rate-quotes` (placeholder comment).
- `docs/architecture.md` — two prior portfolio mentions repointed at the resolved design; new `## Portfolio` section (rationale, same-`sAppId`-two-schemas, tables, no-signatures, identification, cross-device consistency, recovery, double-create reconciliation).

## Review findings

**Read first (fresh eyes), then the handoff.** Reviewed the schema against `schema/draft1.qsql` house style and the doc against the schema and its cross-references.

### Checked — schema (`schema/portfolio.qsql`)
- **`committed.*` in `RevisionMonotonicInt` — correct, and more correct than parts of draft1.** All three revisioned tables (`TallyRegistry`, `LiftJournal`, `AppPreference`) use `from committed.<Table>` for the prior-max lookup. This matches `PartyKey` (the reviewed exemplar) and is *required*: a plain self-ref reads buffered+committed, sees the in-flight row, and makes `Revision = max+1` unsatisfiable. Noted for the record — draft1's own `PartyCertificate` and `TradingVariable` use plain refs here and are the ones at risk, tracked under `debt-deferred-constraint-snapshots`; portfolio does not share that specific bug. The deferred-snapshot *semantics themselves* remain unrun everywhere — same open debt, same uniform fix if a runner disproves it. No change.
- **Latest-wins views** (`CurrentTallyRegistry` / `CurrentLift` / `CurrentPreference`) — correlated `Revision = (select max(...) where key matches)`. With `(key, Revision)` PK + monotonic revisions, exactly one row per key. Correct. (Simpler than draft1's `CurrentTradingVariable` left-join, but draft1 needs the join only to synthesize zero-defaults for parties with no row — portfolio has no such default, so the simpler form is right.)
- **`PortfolioCore` singleton** — `primary key (/* 1 row */)` + `InsertOnly`, same construction as draft1 `Stock` / `TallyContractProposal`. Second-row insert rejected by the empty PK. Unexecuted, but shares the risk with draft1, not portfolio-specific.
- **`Role` CHECK enums** present (`'S'/'F'`, `'O'/'I'/'P'`), matching draft1's inline `check X in (...)` style.

### Checked — docs
- Section anchors resolve: `#portfolio`, `#key-recovery`, `#denominations-and-exchange` all exist.
- Both repointed mentions (§ "A Tally Is a Strand", § "Schema and Integrity Model") and the § "Denominations and Exchange" / § "Lifts and ChipNet" references are consistent with the new design. No stale portfolio prose remains.

### Found + fixed (minor, inline)
- **Double-create reconciliation was under-specified — the merge is not "a plain revision-append."** `docs/architecture.md` § "First-launch reconciliation" claimed the survivor absorbs the loser's rows by plain append "since every portfolio table is keyed for it." That is wrong on two counts a runner would hit: (1) the revisioned tables are keyed `(key, Revision)`, so a loser row for a key that also exists in the survivor **collides on the PK and `RevisionMonotonicInt`** — migration must re-insert at the survivor's `max(Revision)+1` per key (renumber, not blind-append), and same-key conflicts resolve last-migrated-wins; (2) `PortfolioCore` is a non-revisioned singleton — the survivor already has one, so the loser's identical marker is **discarded, not migrated**. Rewrote the paragraph to state renumber-on-migrate, the last-writer-wins semantics for concurrently-edited keys, and the singleton discard, so `feat-portfolio-app-wiring` builds against an accurate spec. This was the one place the doc spec was not complete enough for the backlog ticket.

### Considered — not defects, no change
- **`State` columns unconstrained** (`TallyRegistry.State`, `LiftJournal.State` are free `text`, no CHECK, while `Role` has one). Defensible: `TallyRegistry.State` is a *cache mirror* of the tally strand's state — a CHECK here would reject rows if the tally schema ever adds a state, which is worse than accepting an unknown string. `LiftJournal.State` is the agent's own evolving state-machine enum. Left as-is, consistent with draft1 leaving many text fields unconstrained.
- **`PortfolioCore.Version` / `Created`** are written but nothing reads them yet — forward-looking, fine (doc table summary omits them, which is acceptable summarization).

### Tripwires (already recorded as `NOTE:` at the sites — index only)
- `schema/portfolio.qsql` head — `interactive` latency hint set at strand creation (app-wiring), noted in schema for the reader.
- `schema/portfolio.qsql` head — insert-only revisioned tables grow unboundedly; add compaction only if a long-lived portfolio's history grows costly. Do not build now.
- `TallyRegistry.CounterpartyCertificate` / `BalanceCache` — display-only cache; exact reads go to the tally strand.

### Not run — validation
Lint/tests could not be run: **no Taleus schema runner or build scaffolding exists** (design phase; only the unrelated `tess/package.json` is in-tree). `schema/portfolio.qsql` was reviewed for structural consistency with draft1's already-reviewed patterns, not executed — same unexecuted posture as `schema/draft1.qsql`. The handoff's use-case list (singleton reject, revision monotonicity, latest-wins, portfolio identification, lift state advance) remains the correct test floor to land when a runner exists; no test files created because there is no harness to run them. No pre-existing test failures to report (nothing to run).

### Not filed as tickets
- No **major** findings → no new `fix`/`plan`/`backlog` ticket. The one doc gap was minor and fixed inline. App-layer runtime wiring (first-launch create/locate/reconcile/registry-sync) remains correctly scoped out and parked in `backlog/feat-portfolio-app-wiring`; the doc spec it builds against is now accurate (see fix above).
