description: Let nodes remember the routes and reachable parties they have already discovered, so a later payment to the same place can reuse what was learned instead of searching the whole network again from scratch.
files: packages/tallynet/docs/design.md, packages/tallynet/src/discovery/, ../chipnet/doc/discovery.md
----

Surfaced by the ChipNet regression check (`packages/tallynet/docs/chipnet-review.md` § Regression check) as **designed in ChipNet's docs, built in neither code base, and owned by no TallyNet ticket, with no recorded decision-not-to-build.** ChipNet's `doc/discovery.md` § Overview lists caching of disclosed logical/comms addresses as a core efficiency lever: a node that learned how to reach some party (or saw a useful path) caches it so future searches toward the same destination start warm or skip discovery entirely.

TallyNet today runs every search cold: each `discover` mints a fresh session and walks the graph from the originator, keeping per-session state only for the life of that search (the durable/in-flight split in `src/discovery/store.ts` is *within* one search, discarded after). Nothing persists across searches.

## Why this matters / use case

Repeat payments are common — a node pays the same counterparties again and again. Re-searching the whole neighbourhood each time is wasteful and slow, and it is exactly the cost query-economics (`debt-tallynet-query-economics`) tries to bound on the *answering* side. Caching bounds it on the *asking* side.

## Scope / open questions (for the plan stage, not now)

- **What is cacheable without breaking anonymity.** Edges travel as per-session nonces, deliberately unlinkable across sessions; a naive path cache keyed by nonce is useless across sessions and a cache keyed by real link ids re-introduces the linkability nonces were meant to prevent. Decide what a node may cache (a *reachability* hint — "the payee is reachable via neighbour X in ~k hops" — vs a concrete path) and how it survives per-session nonce rotation.
- **Staleness.** Tally balances and reachability change; a cached route can be gone. Cache entries need a confidence/expiry and a cheap revalidation, or the cache must degrade gracefully (a miss just falls back to a full search).
- **Interaction with `feat-tallynet-routing-hints`** (payee-published reachable parties) and **`feat-tallynet-bidirectional-search`** (searches from several points): a cache is one source of hints; keep the hint-ingestion seam shared.
- **Where it lives.** TallyNet protocol (a cache port the host fills) vs a Taleus concern. Likely a port, like the other discovery state.
- Measure against the simulator: hit rate and search-cost reduction on repeat-payment workloads (needs the trading model, `feat-tallysim-trading-model`).
