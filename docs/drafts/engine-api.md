# Engine API — draft for discussion

**Status: draft, for reaction.** Nothing here is settled. It is written from the app side: the mobile
stories are complete and reviewed, the first screens are being generated, and mock mode is currently
standing in for an engine that does not exist. This is what the app finds itself asking for. Where the
engine's real shape should differ, it should — the app is the easier side to move.

Companion material:

- `packages/taleus-app/design/specs/domain/interfaces.md` — the same surface stated for app authors
- `packages/taleus-app/mock/data/` — the executable form: fixtures the app reads today
- `tickets/backlog/feat-engine-tally-api.md` — the ticket this draft is fodder for

## What the app is asking for, and what it is not

The app never touches Quereus, Optimystic, or the cadre. Everything it knows about a tally arrives
through this surface, and everything it does to one goes back through it. That boundary is what makes
mock mode possible at all, and it is worth keeping even where a shortcut would be convenient.

The app is **not** asking for a database. It does not want to write SQL, hold transactions open, or
know that a tally is a strand. It wants questions answered and acts performed.

## Shapes the app depends on

**Amounts are whole numbers.** A quantity is an integer count of a unit's smallest part, carried with
its unit and scale: `18000` of `iso4217:USD` at scale 2 is $180.00. The app formats; it never
computes in decimals. This mirrors `Ledger.Units` and should stay that way.

**Balances state a perspective.** A balance means the opposite thing to each party, so the app asks
for it already oriented: *owed to me*, *owed by me*, or *level*. Nothing good comes of every screen
re-deriving a sign from stock/foil.

**States are derived, and carry whose turn it is.** `Forming | Offered | Expired | Open | Amending |
Closing | Closed`, each with `waitingOn: me | them | nobody`. The second half is what an attention
list is built from, and computing it in two apps independently is how they drift apart.
See `feat-schema-tally-state`.

**Errors are values.** Every ask can answer "no, and here is why" — `{ kind, message, retryable }` —
rather than throwing. A tally that cannot be read is a state a screen renders, not a crash.

## The asks

Grouped as the app uses them. Names are placeholders; the shape of the answer is the point.

### Reading

| Ask | Answers | Stories |
|-----|---------|---------|
| my party | identity, display unit, disclosures, devices | 10, 11, 42 |
| my tallies | per tally: counterparty, unit, balance, state, waitingOn, last activity | 04, 06 |
| a tally | terms in force both directions, the governing agreement, counterparty disclosure, close state | 04, 07 |
| a tally's entries | signed entries, each with the balance that resulted and whether it was direct or routed | 24 |
| a tally's requests | outstanding and settled, with what was applied and how long outstanding | 21, 22 |
| what needs me | items across all tallies waiting on this party, with amount and deadline | 23 |
| my position | owed and owing per unit; an estimate in the display unit naming what it excludes; spending power kept separate from holdings | 40, 41 |

### Acting

| Ask | Notes | Stories |
|-----|-------|---------|
| invite | terms, unit, agreement, expiry; yields something shareable | 01 |
| respond to an invitation | disclose, set own terms, accept / counter / refuse | 02 |
| propose, counter, accept, refuse terms | each a signed act; refusal reaches the other party | 03 |
| request terms only they can grant | a request, not a proposal — binds nobody | 03 |
| record value given | optionally answering one or more requests | 20, 22 |
| request payment | ask, withdraw; ages rather than expiring | 21 |
| close | request, withdraw the request | 05 |
| set trading settings | signed; standing permission for automated settling | 31 |
| set exchange rates | private; directional; may follow a published source | 41 |
| manage devices | list, add, retire — never the last one | 12, 13 |
| reach someone | can value reach this payee, how much, at what cost, **as of now** | 30 |

## Properties the stories depend on

These are the parts where a plausible-looking API would quietly break the design.

**An act happened or it did not.** No partial outcomes, and the app is told which. This is sharpest
at a shop counter: story 20 path D turns on the fact that a write with the counterparty absent
*fails* rather than queueing, because a shared record needs enough of both sides present.

**Two classes of signing, kept apart.** Terms, payments, disclosures, close requests, corrections and
changes to trading settings are signed by the party in the moment. Lifts are not: they run under
settings the party signed earlier. An API that made lift settling look like an ordinary write would
invite the app to prompt for something the party already authorized — and one that made a payment
look automatic would be worse.

**Feasibility is a snapshot.** "Can value reach this payee" is true when asked and may not be true
when committed. The app needs to say so, so the answer should not look like a promise.

**Requests are not offers.** An offer expires and is not revocable. A request commits nobody, does not
expire, is withdrawable by whoever sent it, and may be answered in part or by a payment that also
answers other requests. See `feat-invoice-lifecycle`.

**Nothing is findable that has not chosen to be.** There is no directory, so every "pay this party"
flow starts from something that party issued.

## Run modes

The app ships one code path and three modes (`interfaces.md` § Run modes): fixtures with no engine;
engine on a local store with no peers; engine in a live cadre. The middle one is what makes
negotiation testable without standing up two cadres, and it is the mode most likely to be skipped and
most missed later. See `feat-engine-run-modes`.

## Questions for the engine side

1. **Shape.** Callable operations, observable queries, or both? The app re-renders when a counterparty
   acts, which argues for something subscribable — but that is a real cost and the app can poll.
2. **Where derived state is computed.** If `feat-schema-tally-state` materialises state and
   `waitingOn`, this surface mostly re-exposes them. If not, this layer derives them. Either is fine;
   two independent derivations are not.
3. **One surface or two?** A party's tallies are separate strands; their portfolio is another. The app
   would rather ask one thing "what do I hold" than assemble it.
4. **Identity of an act.** The app must be able to retry a payment without risking two entries. A
   client-supplied id that the engine treats as idempotent would settle it.
5. **How much of a counterparty must be present** for a write to commit, and can the app know that
   before asking a party to sign?
6. **Days or moments.** Some values are calendar days — when credit terms take effect, when a notice
   period runs out — and read the same to both parties wherever they are. Others are moments: when an
   entry was signed, when a request was made. If everything arrives as a timestamp the app cannot
   tell them apart, and rendering a day through the reader's zone shows the wrong date roughly half
   the time. Either the engine distinguishes them in its types, or it tells the app which fields are
   which. (This is not hypothetical — the mobile app shipped "Mar 1" for a `2026-03-02` effective
   date until the fixtures were changed to carry dates as days.)

7. **A unit's divisor.** Every unit needs one number the apps do not currently get: how many of its
   smallest parts make one whole. For dollars that is 100, for CHIP 1000 — both recoverable from
   `scale`. But a community unit may divide some other way; an hour into sixty minutes is the obvious
   case, and no exponent expresses it. Declaring `divisor` outright covers both and makes `scale`
   derived rather than primary. The apps need it for arithmetic *and* for display, since it decides
   how a figure is written — see `packages/taleus-app/design/specs/domain/amounts.md`.
