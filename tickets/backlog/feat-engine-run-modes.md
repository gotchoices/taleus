description: Make the engine usable in three ways — with no engine at all for design work, on a single device with no network, and fully live with peers — so the app can be built and tested long before a real network exists.
prereq: feat-engine-tally-api
files: packages/taleus/src/index.ts, packages/taleus-app/design/specs/domain/interfaces.md
difficulty: medium
----
## Why this ticket exists

The mobile app is being designed and generated screen by screen, and most of that work happens with
nobody to trade with. Screenshots for review, UI iteration, and automated tests all need the app to
produce known, repeatable states on demand. Meanwhile developers testing real engine behavior need
it to run on one machine without libp2p, peers, or a second party.

The app design names three modes (`packages/taleus-app/design/specs/domain/interfaces.md`): fixtures
only, engine on a local store, engine in a live cadre. The first is entirely an app concern. The
other two need the engine to cooperate.

## Outcomes we're after

- A developer can run the engine against a local database on one device, with no networking, and
  exercise tally logic — negotiation, terms, balances — end to end.
- The same app code paths run in local and live modes; switching is configuration, not a fork.
- A test can set up a party with a known set of tallies in known states, deterministically, without
  standing up two cadres.
- Where a mode genuinely cannot support something (a lift needs a counterparty), the failure is
  clear rather than mysterious.

## Open questions

- Whether "engine on a local store" means a real Quereus database with the schema and no Optimystic
  networking, or something lighter — and what fidelity is worth paying for.
- Whether two-party scenarios can be simulated in one process (both parties' strands local), which
  would make negotiation testable without a network at all. This may be the highest-value part of
  the ticket.
- What a test fixture format looks like, if the engine should own one at all.
