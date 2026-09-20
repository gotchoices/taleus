# taleus

The Taleus **core library** — platform-neutral tally logic, negotiation, the lift
agent, cryptography, the ChipNet transport adapter, and the Quereus sApp schema
(`schema/`). Runs in Node, the browser, and NativeScript.

Consumed by [`taleus-node`](../taleus-node) (the always-on trading service) and
[`taleus-app`](../taleus-app) (the mobile client). Design lives in
[`docs/architecture.md`](../../docs/architecture.md).

```
src/crypto/     hash + signature provider (sha256 / ed25519)
src/lift/       conversion, discovery, referee, commit, agent
src/transport/  /taleus/chipnet/1.0.0 protocol adapter
schema/         Quereus sApp schema (draft1.qsql tally, portfolio.qsql)
```
