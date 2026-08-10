description: Give the apps a way to carry a tally through its whole life — invite, respond, offer, accept, close, and read what's in force — without reaching into the database layers themselves.
prereq: feat-offer-lifecycle, feat-schema-tally-state
files: packages/taleus/src/index.ts, packages/taleus/schema/draft1.qsql, packages/taleus/schema/portfolio.qsql, packages/taleus-app/design/specs/domain/interfaces.md, packages/taleus-app/design/stories/mobile/
difficulty: hard
----
## Why this ticket exists

The `taleus` library today exports crypto, transport, and the lift agent. There is no tally or
negotiation surface, so an app that wants to invite someone, review an offer, or show what a tally
currently obligates its owner to has nowhere to call.

The app design (`packages/taleus-app/design/`) states a boundary we would like to hold: apps read
and write tally state **only** through this library. Quereus, Optimystic, and the cadre stay behind
it. Every screen the mobile app grows will sit on whatever this ticket produces, so its shape
matters more than most.

## Use cases it has to serve

Drawn from the drafted stories in `packages/taleus-app/design/stories/mobile/`:

- **Invite** (story 01) — a party sets what it will extend, picks the unit, sets how long the
  invitation is good for, and produces something shareable in person or remotely.
- **Respond** (story 02) — an invitee sees who is inviting them and on what terms *before*
  disclosing anything, then discloses, sets their own side, and accepts, counters, or walks away.
- **Negotiate** (story 03) — either side counters; each sees what changed; agreement is reached when
  the same offer carries both signatures.
- **Live tally** (story 04) — both sides read the balance in the tally's unit, the terms in force
  from their own perspective (what I extend / what they extend), and the counterparty's disclosed
  identity.
- **Ongoing** (stories 05-07) — request close, find a tally among many, read the agreement behind it.

## What good looks like

- An app developer can build the above without knowing what a strand is.
- The same surface serves the mobile app and, later, a web app — nothing in it is React Native
  shaped.
- "What are the terms in force right now" and "what is being proposed" are separately answerable,
  including the effective date of a pending credit-terms change (the schema's `EffectiveDateValid`
  rule already delays restrictive changes by the prior notice period).
- Reading is cheap and repeatable; the app is expected to ask often.

## Open questions for the implementer

- **Shape.** Callable operations, reactive/subscribable queries over tally state, or both? The apps
  want to re-render when a counterparty acts, which argues for something observable, but that is a
  judgment call with real cost.
- **Where derived state is computed.** `feat-schema-tally-state` proposes materializing lifecycle
  state as a view. If that lands, this surface mostly re-exposes it; if it doesn't, this layer
  derives it. Either is defensible — pick one and say why.
- **Portfolio vs tally.** A party's tally list, display preferences, and quotes live in the
  portfolio strand, while each tally is its own strand. Whether apps see one merged surface or two
  is unresolved.
- **Errors.** What an app is expected to do when a counterparty's cadre is unreachable mid-negotiation.
- **Can a party record anything while the counterparty is unreachable?** A tally is one shared
  record, so whether a write commits with the other side offline is a consensus question, not a
  presentation choice — and the answer changes what the app must say. A party who records and
  converges later needs different words from one who cannot record at all. This matters most at a
  shop counter, where "did that go through" is the only question the user has. See
  `packages/taleus-app/design/stories/mobile/20-pay-a-partner.md` § Open.

## Not in scope

Lift initiation and trading variables (separate stories, not yet written). Payments and invoices —
those exist in the schema but their app surface is a later ticket.
