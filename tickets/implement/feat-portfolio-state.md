----
description: Build the private per-user store — the list of tallies a person holds, their exchange rates, in-flight lift bookkeeping, and app settings — as its own single-owner Sereus strand, and define its schema.
prereq:
files: schema/portfolio.qsql, docs/architecture.md, schema/draft1.qsql
difficulty: medium
----
Background: `docs/architecture.md` — the **portfolio** is the party-level private state that replaces the MyCHIPs user database: which tallies I hold, my exchange-rate quotes, pending-lift bookkeeping, and app preferences. It is private to the party (never shared into any tally strand) yet must be visible to *all* the party's own devices — phone plus any always-on cloud/NAS node that runs the lift agent.

## Design decision (resolved by the plan)

The portfolio lives in a **single-party Sereus strand**: a closed strand whose only member is this party, carrying a Taleus portfolio schema (`schema/portfolio.qsql`).

Why this over the two alternatives the plan weighed:

- **Not the Sereus control network** (`CadreControl`). The control network is a private Optimystic network of only the party's own cadre nodes — which is exactly the visibility we want — but its schema is **platform-owned** (`Strand`, `FormationInvite`/`FormationUsage`, `AuthorityKey`, `CadrePeer`; see `../sereus/docs/architecture.md` § Control Network). Sereus's own guidance puts application data in an sApp strand (the layer-3 `App.*` tables), not in the control schema (`../sereus/docs/strands.md` § Strand Membership Bootstrap — three consent layers, do not conflate). Mixing app state into platform schema is the anti-pattern that guidance exists to prevent.
- **A single-party strand** cleanly separates app state, reuses strand replication + hibernation, and is naturally caught by the phone's existing `sAppId:taleus` strand filter. A single-member closed strand is a supported Sereus configuration — the founder-bootstrap branch (`count(Member) <= 1`) and solo `bootstrap` mode already handle a one-member cohort; the cohort is just this party's own cadre, so the portfolio replicates to every one of the party's nodes including the always-on lift-agent node.

**Same `sAppId`, two schemas.** The phone runs one `CadreNode` with one strand filter (`sAppId:taleus`), so both the portfolio strand and every tally strand must share `sAppId = taleus` to be picked up. `sAppId` is a filter tag, not a schema identity — each `Strand` row names its own sApp schema, so one `taleus` sAppId hosts both the two-party tally schema (`schema/draft1.qsql`) and the single-party portfolio schema (`schema/portfolio.qsql`). The app tells them apart by the `PortfolioCore` marker row (see below), not by member count alone.

**No signatures.** The tally schema is signature-gated because it defends against a counterparty. The portfolio strand's cohort is a single cadre — the party's own devices — so the Sereus strand-membership layer (only this cadre may write) is the sole write gate. Portfolio tables carry **no `verify()` / signature constraints**. They keep the rest of the house style: **insert-only, revisioned, latest-wins views** (mirrors `TradingVariable` in `schema/draft1.qsql`, minus the crypto). Rationale: uniform with the tally schema and with what `feat-exchange-rate-quotes` already assumes (revisioned, unsigned quotes); state advances by appending a revision, a view exposes the current row.

## Portfolio schema (`schema/portfolio.qsql`)

```
-- Single-party portfolio strand. sAppId taleus; cohort = this party's own cadre.
-- Private (never shared into a tally strand). No signatures: Sereus strand
-- membership is the only write gate. Insert-only + revisioned + latest-wins views.

-- Singleton marker + owner identity. Presence of this row is how the app recognizes
-- a strand as *the* portfolio (vs a tally strand, which has TallyCore instead).
create table PortfolioCore (
    OwnerSid text,        -- this party's Sid; same identity used in its tally strands
    Version integer,      -- portfolio schema/protocol version
    Created text,
    primary key (/* 1 row */),
    constraint InsertOnly check (0) on delete, update
);

-- One logical entry per tally the party holds; revisioned. This is a *cache/index*
-- over the party's tally strands, not the authoritative tally state (that lives in
-- each tally strand). Reconstructible from CadreControl.Strand + reading each tally.
create table TallyRegistry (
    StrandId text,                       -- the tally strand's id
    Revision integer,
    Role text check Role in ('S', 'F'),  -- this party's seat: Stock or Foil
    CounterpartySid text,
    Denomination text,                   -- cached from the tally's accepted contract
    DenominationScale integer,
    State text,                          -- forming|open|closing|closed|void (cached)
    CounterpartyCertificate text null,   -- cached cert (display w/o waking the tally)
    BalanceCache integer null,           -- last-known perspective balance (display only)
    Updated text,
    primary key (StrandId, Revision),
    constraint RevisionMonotonicInt check (Revision = Coalesce((select max(Revision) from committed.TallyRegistry T where T.StrandId = New.StrandId), 0) + 1) on insert,
    constraint InsertOnly check (0) on delete, update
);
create view CurrentTallyRegistry as
    select R.* from TallyRegistry R
    where R.Revision = (select max(Revision) from TallyRegistry T2 where T2.StrandId = R.StrandId);

-- In-flight lift bookkeeping: the agent's cross-tally correlation of a lift in progress.
-- The authoritative per-edge state is the pending lift chit in each tally strand's Ledger;
-- this journal is the private "which lift, which edges, what state" map the agent needs to
-- drive discovery/commit across strands. Revisioned; advances by appending a new State.
create table LiftJournal (
    LiftId text,
    Revision integer,
    Role text check Role in ('O', 'I', 'P'),   -- Originator | Intermediary | Payee
    State text,                                 -- proposed|discovering|pending|committed|aborted|timedout
    Edges text,                                 -- JSON: [{ strandId, denom, units, direction }]
    Referee text null,
    Updated text,
    primary key (LiftId, Revision),
    constraint RevisionMonotonicInt check (Revision = Coalesce((select max(Revision) from committed.LiftJournal J where J.LiftId = New.LiftId), 0) + 1) on insert,
    constraint InsertOnly check (0) on delete, update
);
create view CurrentLift as
    select J.* from LiftJournal J
    where J.Revision = (select max(Revision) from LiftJournal J2 where J2.LiftId = J.LiftId);

-- App preferences: key/value, revisioned (e.g. display currency, notification prefs).
create table AppPreference (
    Key text,
    Revision integer,
    Value text,
    Updated text,
    primary key (Key, Revision),
    constraint RevisionMonotonicInt check (Revision = Coalesce((select max(Revision) from committed.AppPreference P where P.Key = New.Key), 0) + 1) on insert,
    constraint InsertOnly check (0) on delete, update
);
create view CurrentPreference as
    select P.* from AppPreference P
    where P.Revision = (select max(Revision) from AppPreference P2 where P2.Key = P.Key);

-- ExchangeRateQuote is added into THIS file by feat-exchange-rate-quotes (private,
-- revisioned, unsigned). Do not define it here; that ticket owns its structure + math.
```

## Consistency

- **Read-your-writes across devices.** The phone edits a rate quote / registry entry; the always-on lift agent reads at decision time. Both are nodes in the same single-party strand cohort, so plain Optimystic replication carries the write. There is **no cross-party consensus** (single party), only intra-cadre replication. Expectation to call out in docs: if the phone's write has not yet replicated to the always-on node when a lift decision fires, the agent reads the prior revision — acceptable, and for rate quotes it is bounded by the quote's own validity window (`feat-exchange-rate-quotes`). No read-your-writes guarantee is asserted *across* devices; each node reads the latest revision it has replicated.
- **Concurrent edits from two devices.** Both append a new revision; the `(Key/StrandId/LiftId, Revision)` primary key + Optimystic write ordering serialize them, rejecting the loser's duplicate revision (same pattern as concurrent `PartyKey` adds in `schema/draft1.qsql`). Latest committed revision wins; the loser retries against the new max. No signature or reconciliation protocol needed.

## Recovery

The portfolio is the *map* of the party's financial life, so losing it must not lose tallies — and it does not:

- **Tallies are independently recoverable.** Each tally is its own strand whose cohort includes the counterparty; it is recovered via cadre membership + `PartyKeyAdoption` (`docs/architecture.md` § Key recovery), entirely without the portfolio.
- **The registry is reconstructible.** The tally-registry portion is an index over strands the cadre already belongs to. `CadreControl.Strand` (control network) lists every strand this cadre operates; re-enumerating the `sAppId:taleus` strands and reading each tally's `TallyCore` / `TallyContract` rebuilds `TallyRegistry` from scratch. So a lost portfolio strand costs no tally.
- **Rate quotes, lift journal, and preferences are NOT reconstructible** — they are private policy/bookkeeping with no external source. Durability for these rests on the portfolio strand replicating to a durable node (the always-on cloud/NAS node the party adds for the lift agent) plus optional user export/backup. A phone-only party that loses its phone loses its quotes and preferences (not its tallies) — the same durability tradeoff Sereus states for a single-device cadre. Document this honestly; do not claim the portfolio is recoverable from counterparties.

## Scope

This ticket delivers the **schema file + docs**. The app-layer runtime wiring — creating the portfolio strand at first launch, locating it on subsequent launches, reconciling an accidental double-create, and syncing the registry cache from tally strands — is **out of scope** because there is no app/build scaffolding yet (design phase; see `AGENTS.md`). That wiring is parked in `backlog/feat-portfolio-app-wiring`. The design for it lives in docs (below) so the backlog ticket has a spec to build against.

## Edge cases & interactions

- **Portfolio identification.** The app must recognize *the* portfolio strand among `sAppId:taleus` strands. Rule: it is the strand carrying a `PortfolioCore` row whose `OwnerSid` = this party's own Sid. This is self-locating — no external pointer to lose. (Member-count-of-one alone is insufficient: a tally mid-formation is also briefly one-member. The `PortfolioCore` marker is the discriminator.) Test: a fixture with one portfolio strand + several tally strands resolves the portfolio uniquely; a strand with `TallyCore` is never mistaken for the portfolio.
- **Double-create race (concurrent forked access).** Two of the party's devices (phone + always-on node) can both check "no portfolio exists yet" and both create one at first bring-up, since they share the control network's `Strand` view. Result: two portfolio strands. The schema cannot prevent this (they are separate strands). Design mitigation, specified for the app-wiring backlog ticket and documented here: on detecting >1 portfolio strand for `OwnerSid`, deterministically keep the one with the lexicographically-lowest `StrandId`, migrate any rows from the loser, and drop the loser from the cadre. The schema side must make this survivable: `PortfolioCore` is a singleton *per strand*, and all portfolio tables are keyed so a merge is a plain revision-append into the survivor. Name this in docs as a known first-launch reconciliation step; do not leave it implicit.
- **Registry cache drift.** `TallyRegistry` caches counterparty cert / state / balance from each tally strand; the tally strand is authoritative and can advance while hibernating (a counterparty writes a chit). The cache is refreshed opportunistically when the tally wakes. Reads that must be exact (a payment amount) read the tally strand, not the registry cache. `NOTE:` at the `BalanceCache` / `CounterpartyCertificate` columns: display-only cache, authoritative source is the tally strand.
- **Portfolio hibernation vs the lift agent.** The always-on lift agent must read quotes/journal at decision time; the portfolio strand may be hibernating. It carries the `interactive` latency hint (same as tally strands) so agent activity locally wakes it (`../sereus/docs/architecture.md` § Strand Hibernation, local wake). `NOTE:` at the schema head that this strand is `interactive`, woken by lift-agent reads/writes.
- **Insert-only growth (tripwire).** Revisioned insert-only means `TallyRegistry` / `LiftJournal` / `AppPreference` grow unboundedly as state churns (a lift with 6 state transitions = 6 `LiftJournal` rows; a chatty balance-cache update = a row per update). Fine now — a portfolio holds hundreds of tallies, not millions of rows. `NOTE:` at the schema head: if a long-lived portfolio's revision history ever grows costly, add compaction (drop superseded revisions) — it is safe precisely because these tables are private and unsigned, so there is no audit/consensus reason to retain history (unlike the tally `Ledger`). Tripwire only; do not build compaction now.
- **Total cadre loss.** Every node gone → portfolio strand gone with the cadre's keys. Tallies recover independently (above); quotes/prefs are lost unless a durable node or user export existed. This is a documented durability limit, not a bug to fix here.
- **Deferred-constraint snapshot.** The `RevisionMonotonicInt` checks read `committed.*` so the row being inserted is excluded from its own `max(Revision)` — identical rationale to `schema/draft1.qsql` (see `docs/architecture.md` § Deferred-constraint snapshots and `tickets/backlog/debt-deferred-constraint-snapshots.md`). Reuse that pattern verbatim; do not invent a new one.

## TODO

- Create `schema/portfolio.qsql` with `PortfolioCore`, `TallyRegistry`, `LiftJournal`, `AppPreference` and their latest-wins views, exactly per the block above (insert-only, revisioned, unsigned; `committed.*` in the revision guards).
- Add the `NOTE:` tripwire comments named in *Edge cases*: `interactive` latency + local wake at the schema head, insert-only growth/compaction at the schema head, and display-only cache at `BalanceCache` / `CounterpartyCertificate`.
- Update `docs/architecture.md`:
  - Refine the two existing portfolio mentions (the paragraph after § "A Tally Is a Strand", and the closing sentences of § "Schema and Integrity Model") to point at the resolved design instead of the vague "private state in the party's own cadre".
  - Add a **`## Portfolio`** section: single-party strand rationale (vs control network), same-`sAppId`-two-schemas, the four tables' purpose, no-signatures rationale, the `PortfolioCore` identification rule, the read-your-writes/consistency expectation, the reconstruct-from-`CadreControl.Strand` recovery story, and the double-create reconciliation step (as the spec the app-wiring backlog ticket builds against).
- Confirm `schema/portfolio.qsql` parses under the same tooling `schema/draft1.qsql` uses (there is no runner yet — if none exists, note that validation is deferred, consistent with how `draft1.qsql` is currently validated). Do not skip or fake a green run.
- Tests (specified up front; land when a schema runner / app harness exists):
  - `PortfolioCore` singleton: a second-row insert is rejected.
  - `TallyRegistry` revision monotonicity: two concurrent same-`StrandId` inserts — one wins on the `(StrandId, Revision)` PK, the loser is rejected and retries against the new max.
  - `CurrentTallyRegistry` / `CurrentLift` / `CurrentPreference` each return exactly the latest revision per key after several appends.
  - portfolio-strand identification: among a fixture of one portfolio + N tally strands, the `PortfolioCore.OwnerSid = self` strand resolves uniquely; a `TallyCore` strand never matches.
  - `LiftJournal` state advance: appending revisions O→discovering→pending→committed leaves `CurrentLift` at `committed`.
