----
description: Review the private per-user portfolio store — a single-owner Sereus strand holding a party's tally list, exchange rates, in-flight lift bookkeeping, and app settings — and its new schema file.
prereq:
files: schema/portfolio.qsql, docs/architecture.md, schema/draft1.qsql, tickets/backlog/feat-portfolio-app-wiring.md
difficulty: medium
----
Implement handoff for `feat-portfolio-state`. Treat the schema + docs as a starting point; the tests below are a floor, not a ceiling — there is no runner yet, so **nothing here has been executed**.

## What was built

- **`schema/portfolio.qsql`** (new) — the single-party portfolio strand schema. Four tables + three latest-wins views, following the `schema/draft1.qsql` house style (insert-only, revisioned, `committed.*` in the revision guards) but with **no signatures** (the strand's single-cadre membership is the sole write gate):
  - `PortfolioCore` — singleton marker (`primary key (/* 1 row */)`) carrying `OwnerSid`; its presence identifies a strand as *the* portfolio vs a tally strand (which has `TallyCore`).
  - `TallyRegistry` (+ `CurrentTallyRegistry`) — revisioned display index over the party's tally strands.
  - `LiftJournal` (+ `CurrentLift`) — revisioned in-flight lift bookkeeping.
  - `AppPreference` (+ `CurrentPreference`) — revisioned key/value settings.
  - `ExchangeRateQuote` is intentionally **not** defined here — `feat-exchange-rate-quotes` owns it and appends into this same file (a comment placeholder marks the spot).
- **`docs/architecture.md`** — refined the two prior portfolio mentions (end of § "A Tally Is a Strand"; last sentence of § "Schema and Integrity Model") to point at the resolved single-party-strand design, and added a new **`## Portfolio`** section (rationale vs control network, same-`sAppId`-two-schemas, table purposes, no-signatures rationale, `PortfolioCore` identification rule, cross-device consistency, reconstruct-from-`Strand`-view recovery, and the double-create reconciliation spec the app-wiring backlog ticket builds against).

## Validation status — deferred, honest gap

No Taleus runner/build exists (design phase; only unrelated `tess/package.json` in-tree). `schema/portfolio.qsql` was **not executed** — same posture as `schema/draft1.qsql`, which nothing runs today. Validation is by structural consistency with draft1's already-reviewed patterns, not by a green parse. The reviewer should read it as unexecuted design.

## Use cases / tests (land when a schema runner or app harness exists)

- **`PortfolioCore` singleton** — a second-row insert is rejected by `primary key (/* 1 row */)` + `InsertOnly`.
- **`TallyRegistry` revision monotonicity** — two concurrent same-`StrandId` inserts: one wins on `(StrandId, Revision)` PK, the loser is rejected and retries against the new max (same mechanism as concurrent `PartyKey` adds).
- **Latest-wins views** — `CurrentTallyRegistry` / `CurrentLift` / `CurrentPreference` each return exactly the latest revision per key after several appends.
- **Portfolio-strand identification** — fixture of one portfolio + N tally strands: the `PortfolioCore.OwnerSid = self` strand resolves uniquely; a `TallyCore` strand never matches.
- **`LiftJournal` state advance** — appending revisions O→discovering→pending→committed leaves `CurrentLift` at `committed`.

## Things to scrutinize (reviewer, don't take on trust)

- **`committed.*` in the revision guards.** `TallyRegistry` / `LiftJournal` / `AppPreference` `RevisionMonotonicInt` reuse draft1's deferred-constraint snapshot pattern verbatim. That pattern is itself unexecuted and has an open debt ticket (`debt-deferred-constraint-snapshots`) confirming the same construction is *correct-in-intent but unrun* across the sibling tables. If a runner ever shows the pattern is wrong, it is wrong here too — same fix applies uniformly.
- **`Key` / `Value` as unquoted column names** in `AppPreference`. Both are keyword-ish. Left unquoted deliberately, following draft1 precedent (`Date`, `Number`, `Reference` are used unquoted in `Ledger`). If Quereus rejects them as identifiers when a runner lands, `Date`/`Number` in draft1 fail the same way — a schema-wide quoting decision, not a portfolio-specific bug. Worth confirming, not fixing here.
- **Scope boundary.** App-layer runtime wiring (first-launch create, locate, double-create reconciliation, registry sync) is out of scope by design — no app scaffolding yet. It is specified in `docs/architecture.md` § Portfolio and parked in `backlog/feat-portfolio-app-wiring`. Confirm the doc spec is complete enough for that ticket to build against.

## Tripwires recorded (NOTE comments — index only, see the sites)

- `schema/portfolio.qsql` head — **`interactive` latency / local wake**: the strand carries the interactive hint so lift-agent reads wake it while hibernating; the hint is set at strand creation (app-wiring), noted in schema for the reader.
- `schema/portfolio.qsql` head — **insert-only growth / compaction**: revisioned insert-only grows unboundedly; fine now (hundreds of tallies, not millions of rows); add compaction only if a long-lived portfolio's history grows costly. Safe because private + unsigned. Do not build now.
- `TallyRegistry.CounterpartyCertificate` / `BalanceCache` — **display-only cache**: authoritative source is the tally strand (which advances while hibernating); exact reads go to the tally strand, not the cache.
