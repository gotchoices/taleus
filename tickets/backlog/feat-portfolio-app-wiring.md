----
description: Make the app actually create, find, and keep up to date each user's private portfolio store when the app runs — the runtime plumbing around the portfolio, which can't be built until the app itself exists.
files: docs/architecture.md, packages/taleus/schema/portfolio.qsql
----
The portfolio schema (the single-party portfolio strand and its tables) is defined by `feat-portfolio-state`. This ticket is the **runtime wiring** the app needs to actually use it. The React Native app now exists (`packages/taleus-app/apps/mobile`, scaffolded via appeus) but does not yet embed a `CadreNode`; promote this once it does.

What the app layer must do (design spec lives in `docs/architecture.md` § Portfolio, written by `feat-portfolio-state`):

- **First-launch create.** On a party's first bring-up, form the single-party portfolio strand (founder/solo bootstrap, `publishStrand`), apply `packages/taleus/schema/portfolio.qsql`, and write the `PortfolioCore` marker row with the party's own Sid.
- **Subsequent-launch locate.** Find the existing portfolio strand by scanning `sAppId:taleus` strands for the one whose `PortfolioCore.OwnerSid` = this party's Sid (self-locating; no stored pointer).
- **Double-create reconciliation.** If two of the party's devices raced and created two portfolio strands, keep the lexicographically-lowest `StrandId`, migrate the loser's rows into it (plain revision-append), and drop the loser from the cadre. (Rationale + why the schema can't prevent it: `feat-portfolio-state` § Edge cases.)
- **Registry cache sync.** Keep `TallyRegistry` refreshed from each tally strand opportunistically when that tally wakes (state, counterparty cert, balance cache). The tally strand is authoritative; the registry is a display index. Exact reads (payment amounts) go to the tally strand, not the cache.
- **Registry reconstruction.** Provide the recovery path: rebuild `TallyRegistry` from `CadreControl.Strand` + reading each tally's `TallyCore`/`TallyContract`, for a party whose portfolio strand was lost but whose cadre survives.
- **Lift-agent access.** Ensure the always-on lift agent can wake the portfolio strand (`interactive` hint, local wake) to read `ExchangeRateQuote` / `LiftJournal` at decision time, and write `LiftJournal` state transitions as a lift progresses.

Depends on: `feat-portfolio-state` (schema), `feat-exchange-rate-quotes` (quote reads by the agent), and the eventual app scaffolding + lift-agent work (`feat-chipnet-integration`).
