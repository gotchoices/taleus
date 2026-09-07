# Interfaces

Where app-observable behavior comes from.

## Canonical sources (do not restate here)

| Concern | Lives in |
|---------|----------|
| System design, formation, negotiation, lifts, recovery | `docs/architecture.md` |
| Data model + constraints | `packages/taleus/schema/draft1.qsql` |
| Trading variables | MyCHIPs `schema/tallies.wmt` |

## Engine boundary

Apps read and write tally state only through the `taleus` engine. Quereus, Optimystic, and the cadre
are engine-internal; no target depends on them directly.

## Run modes

One switch point in the data layer. Screens distinguish only mock from engine.

| Mode | Behavior |
|------|----------|
| mock | Fixtures from `mock/data/*` with `variant=happy\|empty\|error`. No engine. |
| engine + local store | Engine over a local database, single device, no peers. |
| engine + cadre | Engine over the embedded cadre node: real strands, peers, lifts. |

## Tally states

Derived by the engine, not stored. The apps display them and build attention lists from them.

| State | Who acts next |
|-------|---------------|
| Forming | the inviting party |
| Offered | the party who has not signed |
| Expired | either — re-offer or abandon |
| Open | either — trade |
| Amending | the party who did not make the later offer |
| Closing | either — settle |
| Closed | nobody |

## What the apps ask of the engine

The engine does not exist yet (`packages/taleus/src` is crypto, lift, and transport). Mock mode is
therefore where the app-facing surface gets defined, and this is that surface stated in concepts
rather than types — enough for `feat-engine-tally-api` to build against, and for the app to be
rewired when it differs.

| Ask | Answers | Stories |
|-----|---------|---------|
| my party | who I am, my display unit, what I have disclosed | 10, 11, 42 |
| my tallies | one row per tally: counterparty, unit, balance, state, whose turn, last activity | 04, 06 |
| a tally | terms in force both directions, agreement, counterparty disclosure, close state | 04, 07 |
| a tally's entries | signed entries with running balance, each marked direct or routed | 24 |
| a tally's requests | outstanding and settled requests, what was applied, how long outstanding | 21, 22, 24 |
| what needs me | items across all tallies waiting on this party, with deadline and cost | 23 |
| my position | owed and owing per unit, an estimate in my display unit, spending power | 40, 41 |
| offer terms | propose, counter, accept, refuse — each a signed act | 01, 02, 03 |
| record value | give value on a tally, optionally answering one or more requests | 20, 22 |
| request value | ask, withdraw, see ageing | 21 |
| close | request, withdraw the request, see why it has not completed | 05 |
| reach someone | can value reach this payee, how much, at what cost, right now | 30 |

Two properties every ask carries, because the stories depend on them: an act either happened or did
not (never partially), and the app is told which — see story 20 path D.

## Dates and instants

Two different things, and the apps must not confuse them. A **date** is a day in the calendar — when
terms take effect, when notice runs out — and reads the same to both parties wherever they are. An
**instant** is a moment — when an entry was signed, when a request was made — and reads in each
party's own zone. The engine says which it is handing over; the apps never format one as the other.

## Amounts, as the apps handle them

An amount is a whole number of a unit's smallest part, plus the unit and its scale — `18000` of
`iso4217:USD` at scale 2 is $180.00. The apps never do arithmetic on a decimal, and never combine
amounts in different units except through an explicit estimate ([rules.md](rules.md)).

## Vocabulary

User-facing terms map to platform terms: **tally** is a two-party strand, a party's devices form a
**cadre**. Stories and specs use the user-facing term.
