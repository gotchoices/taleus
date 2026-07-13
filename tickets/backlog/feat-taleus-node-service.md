----
description: Build the taleus-node always-on trading service — the headless lift agent + /taleus/chipnet/1.0.0 endpoint, run as a client of the party's Sereus cadre. Fills in the scaffolding stub in packages/taleus-node.
files: packages/taleus-node/src/index.ts, packages/taleus-node/src/cli.ts, packages/taleus-node/README.md, docs/architecture.md
----
`packages/taleus-node` exists today as a scaffolding stub (`createTaleusNode` throws, `cli.ts` errors out). This ticket implements it: the always-on process that runs a party's lift agent continuously and serves the ChipNet transport, playing the role MyCHIPs site servers played (design in `docs/architecture.md` § The Stack, § Lifts and ChipNet, § Portfolio).

**Deployment stance (settled): a client of the cadre, not an embedded plugin.** For v1 the service connects to a running Sereus cadre node rather than being loaded into the cadre process. It reaches the party's tally strands and private portfolio strand through that cadre node, and opens `/taleus/chipnet/1.0.0` to counterparties itself. The alternative — a Sereus cadre plugin that folds the agent into the cadre process — is deferred (it needs a plugin runtime Sereus does not yet expose); see `feat-sereus-cadre-plugin-exploration`.

What the service must do:

- **Attach to the cadre.** Take a cadre endpoint in `TaleusNodeConfig`, connect as a client, and obtain read/write access to the `sAppId:taleus` strands (tally strands + the single-party portfolio strand). Exact client API is a Sereus dependency (see Open questions).
- **Run the lift agent.** Drive discovery/commit from the portfolio `LiftJournal`, reading `LiftLading`/`ExchangeRateQuote` and writing `PendingLift`/`Ledger`/`LiftVoid`, using the already-landed `packages/taleus/src/lift/` logic (`agent.ts`, `discovery.ts`, `commit.ts`, `referee.ts`, `convert.ts`).
- **Serve `/taleus/chipnet/1.0.0`.** Host the transport (`packages/taleus/src/transport/`) so counterparties can dial this node for `QueryPeerFunc`/`updatePeer`. Bind ChipNet's injected ports (`DiscoveryEngine`, consensus, `EdgeStrand`) to live implementations.
- **Act as referee when it is the originator's node.** Emit the dual signature (ChipNet whole-record + per-edge Taleus) per § Referee model.
- **Lifecycle.** `start()`/`stop()` with clean resource teardown (libp2p handlers, strand wake subscriptions, agent timers — the jest "worker failed to exit" warning in the lib suite is a reminder to `.unref()` timers here).
- **CLI.** `cli.ts`: parse args/config (cadre endpoint, referee policy, log level), start the service, handle signals.

## Edge cases & interactions

- **Cadre offline / reconnect.** The cadre node the service depends on may restart; the service must reconnect rather than die.
- **Strand wake races.** A tally strand may be hibernating when a lift touches it; coordinate with Sereus wake before reading/writing.
- **Referee reachability.** If this node is the named referee it must stay reachable through the commit window; if it is unreachable, the stuck-reservation path is `feat-lift-timeout-release`.
- **Multiple cadre nodes.** A party may run more than one always-on node; only one should drive a given lift (avoid double-driving). Correlate via `LiftJournal`.
- **Injected-port doubles vs. live.** The lib tests bind in-memory schema-emulating doubles; this ticket wires the live Quereus runner and live ChipNet — expect parity gaps to surface (digest preimage, commit-record shape).

## Open questions (resolve during plan, or route to blocked)

- **Cadre client API.** Does `@serfab/cadre-core` expose an out-of-process client interface for a non-cadre-member process to read/write strands, or must the service itself be a cadre member (its own node in the party's cadre)? If the latter, "client of the cadre" means "an additional cadre node that also runs the agent," which is still not a plugin. Confirm against `../sereus/packages/cadre-core` and `../sereus/packages/cadre-host`.

Prereq / depends on: `chipnet-npm-publish-needed` (blocked — ChipNet unpublished), a live Quereus runner wiring, and the Sereus cadre-client API above. Parked in backlog until those land.
