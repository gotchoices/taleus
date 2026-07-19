# Taleus Documentation

Taleus is a reboot of [MyCHIPs](https://github.com/gotchoices/mychips) on the [Sereus](https://sereus.org)
platform: private credit relationships (**tallies**) as two-party shared databases, with value cleared
around the credit graph by cooperative **lift** transactions.

## Start here

- **[architecture.md](architecture.md)** — the canonical system overview. Read it before any non-trivial
  work: the stack, tally-as-a-strand, formation, the schema/integrity model, portfolio, denominations,
  lifts, and the client app.

## Topic deep-dives

These expand single areas that architecture.md summarizes. Each is timeless (describes the intended
system) and flags its own open questions.

- **[trading-variables.md](trading-variables.md)** — the two per-party sets (`Target/Bound/Reward/Clutch`),
  the balance number-line, and how lift/drop fees compose.
- **[denominations.md](denominations.md)** — quantifying an arbitrary unit of account: designator,
  integer sub-units, and the unit multiplier; the descriptor that carries a unit's *meaning*.
- **[tally-lifecycle.md](tally-lifecycle.md)** — the negotiation state machine (draft → offer → open →
  closing → closed) and the **rights invariant** that governs every state transition, plus the
  taxonomy of ways a tally can (and cannot) get wedged.
- **[concurrency-model.md](concurrency-model.md)** — why a signature-gated, insert-only schema stays safe
  on the Sereus/Optimystic substrate: the CRDT lens and the two load-bearing platform assumptions.

## Drafts (not settled)

Design intentions still under analysis; not yet timeless. See [`drafts/`](drafts/).

- **[drafts/credit-terms.md](drafts/credit-terms.md)** — roadmap from demand credit to rich instruments
  (interest, amortization, vesting). A gap carried over from MyCHIPs, not yet designed.

## Working state

- **[STATUS.md](STATUS.md)** — the live checklist: cross-repo (Sereus/Optimystic/Quereus) items Taleus
  depends on, docs still to write, and small open decisions. Not timeless — pruned as items land.
- **[../tickets/](../tickets/)** — discrete work items (tess). Design decisions and outstanding work live
  here, not in doc TODO sections.

## Legacy

- **[old/](old/)** — pre-Sereus prototype docs (bespoke bootstrap protocol, chunk negotiation). Reference
  only; superseded by Sereus strand formation. Do **not** treat as current design.

## Conventions

- **Docs are timeless** — they describe the intended system. Outstanding work goes in `tickets/`;
  in-progress/uncertain design goes in `drafts/` or `STATUS.md`, not in doc TODO sections.
- **Nomenclature stays MyCHIPs-compatible** where it carries over (stock/foil, chit, lift, tally,
  trading variables). Note the reframings: *stock/foil* are role labels on one shared record (Party S =
  expected creditor, Party F = expected debtor), **not** two database halves; and **ChipNet** is expected
  to be rebranded **tallyNet** (see STATUS).
