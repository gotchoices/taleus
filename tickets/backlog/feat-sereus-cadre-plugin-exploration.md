----
description: Explore folding the taleus-node trading service into the Sereus cadre process as a cadre plugin, instead of running it as a separate client of the cadre. Design spike — decide whether Sereus should grow an app-plugin runtime and whether Taleus should use it.
files: docs/architecture.md
----
v1 runs the always-on lift agent + `/taleus/chipnet/1.0.0` endpoint as a **separate process that is a client of the party's cadre** (`feat-taleus-node-service`), deliberately avoiding a dependency on any plugin runtime. This ticket revisits that once v1 works: should the trading service instead run *inside* the cadre process as a **cadre plugin**?

Taleus is the motivating case because it is "more than a passive sApp" — it adds node-resident logic (a background agent + a peer protocol) that a pure schema-only sApp does not have. A plugin surface would let the cadre host that logic directly (one process, shared libp2p, shared strand access, shared lifecycle/hibernation) instead of a sidecar client.

Questions to answer:

- **Does Sereus want an app-plugin runtime at all?** A generic way for an sApp to register libp2p protocol handlers + background services on a `CadreNode`, with lifecycle and hibernation integration. This is a Sereus-platform design decision, not a Taleus one — coordinate with the Sereus repo (`../sereus`). If yes, it likely belongs there, not here.
- **What does the client-vs-plugin split cost?** Compare the v1 sidecar (extra process, its own connection to the cadre, duplicated libp2p) against a plugin (tighter coupling, but Taleus code running in the platform's process; sandboxing/failure-isolation concerns).
- **Migration path.** If a plugin runtime lands, how does `taleus-node` move from client to plugin without a rewrite — is the agent/transport code already factored so the same `packages/taleus` pieces bind to either host?

Output: a recommendation (stay client / adopt plugin), and if plugin, a coordinated design with Sereus. Likely routes to `blocked/` for the cross-repo platform decision, or to Sereus's own backlog.

Depends on: `feat-taleus-node-service` (need the working client first to compare against). Not urgent — parked until v1 lift flow is proven.
