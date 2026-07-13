# taleus-node

The always-on **Taleus trading service**: a headless process that runs a party's
[lift agent](../../docs/architecture.md#lifts-and-chipnet) and serves the
`/taleus/chipnet/1.0.0` endpoint continuously. It plays the role MyCHIPs site
servers played — now the party's own always-on node.

## Deployment stance (v1)

This service runs as a **client of the party's Sereus cadre**, not as an embedded
cadre plugin:

- It connects to a running cadre node to read/write the party's tally strands and
  private [portfolio](../../docs/architecture.md#portfolio) strand.
- It opens the ChipNet transport to counterparties itself and drives lift
  discovery/commit from the portfolio `LiftJournal`.

Folding the agent into the cadre process as a Sereus plugin is deferred — keeping
it a separate client avoids depending on a plugin runtime Sereus does not yet
expose. See [`docs/architecture.md`](../../docs/architecture.md#the-stack) and the
`feat-taleus-node-service` ticket.

## Status

Scaffolding stub. No behavior yet.
