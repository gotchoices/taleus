description: Make the engine usable in three ways — with no engine at all for design work, on a single device with no network, and fully live with peers — so the app can be built and tested long before a real network exists.
prereq: feat-engine-tally-api
files: packages/taleus-model/src/model.ts, packages/taleus-model/src/mock/index.ts, packages/taleus-app/apps/mobile/src/data/config.ts, packages/taleus-core/src/api/store-memory.ts, packages/taleus-app/design/specs/domain/interfaces.md
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

## Progress

- **The switch exists, and screens see nothing.** `packages/taleus-model` holds the app model: one
  `TaleusModel` interface per namespace, generated from what the mock already answered. The mock
  implementation moved there unchanged (fixtures injected by the app, because Metro bundles JSON only
  through static `require`s). The mobile app's `src/data/*.ts` are now thin forwards, and
  `src/data/config.ts` is the one place an implementation is chosen. Verified as a pure move: the
  app's 190 tests pass, typecheck is clean, and a Metro bundle carries the model and its fixtures.
- **Open question 1 is answered by taleus-core**: "engine on a local store" can be a real Quereus
  database with the real schema and no networking. That is `MemoryFabric`, which the core's 300+
  tests already run on.
- **Open question 2 is answered too**: two parties in one process, each with its own replica, is how
  `MemoryFabric` works today. What remains is a *simulated counterparty* — a scripted second party the
  app can trade with on one device, which also makes UX passes realistic.
- **Open question 3, proposed**: fixtures stay the app model's, but can be *generated* by running the
  contract scenarios through the engine and snapshotting what the model returns, so mock and engine
  cannot drift.

- **Engine mode exists at the package level.** `taleus-model/engine` implements every namespace over
  taleus-core; `createLocalWorld` runs it against a simulated counterparty on one in-memory fabric. A
  whole tally lifecycle runs through the model's own interface with no protocol step done by hand: an
  agent names the tally, publishes both sides' terms and proposes the contract, and the offer waits
  for a person. What the core cannot do yet returns `unsupported`, naming its ticket.
- **The contract suite runs on both.** Neither has drift. The design fixtures had two entries signed
  by the wrong party (the giver signs) and a tally `Closing` at zero with no close request; both
  corrected, so `KNOWN_FIXTURE_DRIFT` is empty.

- **Engine mode runs in the mobile app** (Mode B, `USE_ENGINE = true` in `src/data/config.ts`).
  Verified on an Android emulator under Hermes: first run creates a real identity, an invitation is
  taken up by the simulated counterparty (`createLocalWorld({ takeUpInvitations: true })`), the agent
  forms and opens the tally, and a recorded entry moves the balance and position. How it is wired:
  - `@serfab/cadre-rn/polyfills` + `boot-check` in `index.js`, *after* the app's formatjs `Intl` so
    the kit's English-only `Intl.PluralRules` never installs; `withCadreMetro` in `metro.config.js`.
  - The core emits each schema as a module (`taleus-core/schema-text/<name>`), so no host needs
    bundler support for `.qsql`; `createLocalWorld` defaults to `draft1`.
  - `src/data/engine.ts` is the only module importing the engine, loaded on demand: mock mode and
    every test never evaluate Quereus. (A direct `import('taleus-model/engine')` fails under Metro's
    lazy dev bundles: the URL lands outside the project root.)
  - `App.tsx` gates on `startModel()`; in mock mode it is already started, so nothing waits.

Open:
- Persistence. The in-memory fabric forgets everything on restart, so each launch is a first run.
  Needs a durable store (Optimystic local, or Quereus over the device's storage) plus the identity
  secret in the platform key store, and the session's device-local state.
- Mode C (`USE_CADRE`) throws "not built yet".
- The simulated counterparty only takes up invitations and accepts offers; it never pays, asks or
  closes, so those screens can only be exercised from this party's side.
- Dates: the core keeps UTC calendar days, so near midnight a tally's "in force since" can read a day
  off the local "last activity".
