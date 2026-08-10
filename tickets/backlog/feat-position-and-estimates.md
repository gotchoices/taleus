description: Give a party an honest picture of what they are worth across tallies held in different units, without pretending a single exact number exists.
prereq: feat-engine-tally-api
files: packages/taleus/schema/portfolio.qsql, packages/taleus-app/design/stories/mobile/40-my-position.md, packages/taleus-app/design/specs/domain/rules.md
difficulty: medium
----
## Why this ticket exists

Tallies are denominated in different units, and no unit is privileged. There is therefore no single
true party-level balance — but a person still wants to know roughly how they are doing, expressed in
something they think in.

MyCHIPs had one unit of account, so this never arose. It did, however, set an explicit goal
(`mc/mychips/doc/use-mobile.md`) that the app should teach net worth and the nature of value rather
than merely listing transactions. That intent is worth carrying over.

The portfolio schema already holds `ExchangeRateQuote` — the party's own directional rates, with
their own spread folded in — plus a `CurrentExchangeRateQuote` view.

## Outcomes we're after

- A party sees authoritative totals per unit, in each tally's own unit, always available.
- A party can pick a unit they think in and see an estimated overall position expressed in it.
- The estimate is unmistakably an estimate. It never replaces the per-unit figures, and it is never
  presented as a signed or settled amount.
- The estimate uses the party's *own* quotes, so it reflects how they value things — two parties may
  value identical holdings differently and both be right.
- A party with no quotes for some unit gets something honest rather than a wrong number or a crash.

## Open questions

- What happens when a quote is missing or stale: omit that tally from the estimate, show it
  separately, prompt the user, or something else.
- Whether quotes should have any notion of staleness at all, given they are the party's own policy
  and not a market feed.
- Whether the same conversion machinery serves both display estimates and cross-unit lifts, or
  whether display wants something looser than the lift path requires.
- Whether "position" should distinguish what is owed to the party from what the party owes, credit
  available from balance held, or leave that framing to the app.
