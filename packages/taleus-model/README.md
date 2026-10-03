# taleus-model

The Taleus apps' shared model: everything a Taleus app's screens can read and do, behind one
interface, `TaleusModel`. Screens never learn what answers them.

```
screens ─▶ app data layer (src/data, thin) ─▶ TaleusModel ─┬─▶ mock: fixtures + in-memory writes
                                                           └─▶ engine: taleus-core
```

## What lives where

| | |
|---|---|
| `src/<namespace>.ts` | Shapes, policy constants, pure derivations, and `<Namespace>Model` — the contract. Shared by every implementation. |
| `src/model.ts` | `TaleusModel` (all namespaces) and `MockControls` (variant, resets). |
| `src/mock/` | The mock implementation: fixtures and in-memory writes. |
| `src/engine/` | The engine implementation over taleus-core (subpath `taleus-model/engine`). |
| `src/contract.test.ts` | The contract: one suite run against both implementations. |
| `src/types.ts` | Shapes used across namespaces (`Amount`, `Result`, `TallySummary`…). |

Each namespace is also a subpath export (`taleus-model/attention`), because some shape names repeat
across namespaces (`Terms`, `Agreement`, `Delivery`).

## Rules

- **Framework-free and platform-neutral.** No React, no React Native, no Node at runtime. Platform glue
  — UI bindings, startup, storage, formatting — belongs to each app target.
- **The Taleus product's model, not a general one.** Every Taleus target shares it. A different product
  on Taleus builds on `taleus-core` directly.
- **Fixtures are injected.** React Native bundles a JSON file only through a static `require`, so the
  app supplies a `FixtureSource`; tests read `../taleus-app/mock/data` off disk.
- **Every operation is async**, even where the mock answers at once, because the engine behind it will
  not.

## Consuming it

A Taleus app target depends on it as `"taleus-model": "file:../../../taleus-model"` and consumes the
built `dist/` (`yarn build` here, or `tsc -p tsconfig.build.json --watch`). Metro needs the package in
`watchFolders` and the app's `node_modules` in `resolver.nodeModulesPaths`; Jest needs the same in
`modulePaths` — linked code otherwise looks for Babel's injected helpers beside its own real path.

## Engine mode

`createEngineModel({ store, identity?, now?, agreements? })` gives one party's `TaleusModel` over any
taleus-core store. `createLocalWorld()` is the one-device arrangement: this party plus a
**simulated counterparty**, both on one in-memory fabric — real schema, real signatures, real
refusals, no network. The counterparty is just a second engine model whose agent accepts offers
without asking; a script (or a developer) drives everything else it does through its own model.
`takeUpInvitations: true` also has it take up each invitation this party makes, on the offered
terms — what an app on one device uses. The schema defaults to the core's `draft1`.

What engine mode adds beyond translation:

- **An agent for the steps nobody has a screen for.** After an invitation is taken up, the inviter
  names the tally, each side publishes the terms it already chose, and the inviter proposes the
  contract. The agent does these whenever anything changes; accepting the offer is a decision, so it
  stops there and the offer waits for a person.
- **An invitation envelope.** The core's ticket says where to join and proves the seat is yours, but
  not what is offered — terms are signed against a tally that does not exist yet. The model's token
  carries the ticket plus the offered terms for display; the signed terms follow on the tally.
- **Device-local state** — settings, notifications, rates, devices, "set aside" — that never touches
  a tally. It starts empty: engine mode never borrows the mock's fixtures, which hold sample people.

**On real strands.** `taleus-model/cadre` exports `cadreStoreProvider({ node, sApp })`, a
taleus-core `StoreProvider` over a running Sereus `CadreNode` (built on a phone by
`@serfab/cadre-rn`'s `createPhoneNode`). Each tally is a closed two-party strand with the Taleus sApp.
`create` founds it and mints a single-use strand invitation, which travels in the ticket's
`ref.address`; `join` redeems it and attaches the strand once it has synced. Its test runs two nodes
over loopback and opens a tally with no polling: the counterparty's commits wake the agent.

What the core does not support yet comes back as `{ kind: 'unsupported' }` naming its ticket:
countering an offer, withdrawing a close, withdrawing or part-paying a request, one payment answering
several requests, standing invitations, device management, and asking a counterparty for details.

The engine also records the core's calendar dates as moments at the start of that day, UTC: signers
assert days, not times (`docs/timestamps.md`).

## The contract

`src/contract.test.ts` runs the same checks against both implementations: well-formed tallies, the
list agreeing with the detail, entries ending at the balance, requests and attention items pointing
at things that exist, position summing the tallies, and no drift from the protocol. Fixtures that show
something the engine can never produce fail it; `KNOWN_FIXTURE_DRIFT` names any exception accepted
as a design question, and is empty.
