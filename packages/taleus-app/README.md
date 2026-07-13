# taleus-app

The Taleus **mobile client** — TypeScript + [Svelte Native](https://svelte-native.technology/)
(NativeScript). The app *is* a peer: it embeds a Sereus cadre node
(`@serfab/cadre-core`, strand filter `sAppId:taleus`) directly and the `taleus`
library for tally logic, negotiation, and a best-effort lift agent while the
phone is awake.

App surfaces (see [`docs/architecture.md`](../../docs/architecture.md#client-application)):
tally list + balances, formation (QR invite/scan), negotiation, payments/invoices,
lift activity, and cadre management (delegated to Sereus UX patterns).

Reliable lift participation comes from adding an always-on
[`taleus-node`](../taleus-node) to the cadre; the phone is push-woken for the
commit window when it has no always-on node.

## Status

Placeholder. NativeScript scaffolding lands with `feat-taleus-app-shell` — model
it on the Sereus reference apps (`../../sereus/packages/reference-app-ns`).
