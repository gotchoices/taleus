----
description: Scaffold the taleus-app Svelte Native (NativeScript) mobile client — the app shell that embeds a Sereus cadre node and the taleus library. Turns the packages/taleus-app placeholder into a real, buildable app project.
files: packages/taleus-app/package.json, packages/taleus-app/README.md, docs/architecture.md
----
`packages/taleus-app` is a placeholder today (no-op build/test/lint scripts, no NativeScript project). This ticket scaffolds the real app shell (design in `docs/architecture.md` § Client Application).

**The app *is* a peer.** It embeds a cadre node directly (`@serfab/cadre-core`, strand filter `sAppId:taleus`) and consumes the `taleus` library for tally logic, negotiation, and a best-effort lift agent while the phone is awake. Reliable lift participation comes from the party adding a `taleus-node` to its cadre (`feat-taleus-node-service`); the phone is push-woken for the commit window otherwise.

Scope of this ticket — **shell only**, not the full feature surface:

- **NativeScript + Svelte Native project.** Model it on the Sereus reference app `../sereus/packages/reference-app-ns` (nativescript.config, App_Resources, webpack, hooks). Replace the placeholder scripts with real `build`/`test`/`lint` (or wire them out of the aggregate root scripts if NativeScript tooling can't run headless in CI).
- **Embed a cadre node.** Bring up `@serfab/cadre-core` with the `sAppId:taleus` strand filter and on-device storage via `quereus-plugin-nativescript-sqlite`.
- **Portfolio bring-up.** First-launch create / subsequent-launch locate of the single-party portfolio strand — this is the consumer side of `feat-portfolio-app-wiring` (that ticket is the runtime plumbing; this ticket provides the app it plugs into).
- **Navigation skeleton** for the app surfaces (empty screens are fine): tally list + balances, formation (QR invite/scan), negotiation, payments/invoices, lift activity, cadre management (delegate to Sereus UX patterns).

Later tickets fill each surface; this one only has to build and launch with a working cadre + portfolio.

## Edge cases & interactions

- **Aggregate build/CI.** NativeScript builds need platform SDKs (Android/iOS) that may not run in the root `yarn build`/`yarn test` fan-out; decide whether taleus-app opts out of the aggregate or provides headless-safe script targets. Don't break the green root build.
- **Best-effort agent while awake.** The phone runs the lift agent opportunistically; ensure it doesn't double-drive a lift the party's `taleus-node` is also driving (correlate via `LiftJournal`, same concern as `feat-taleus-node-service`).
- **Double-create portfolio.** Two of the party's devices racing at first launch — reconciliation lives in `feat-portfolio-app-wiring`; the shell must invoke it, not reinvent it.
- **Storage plugin availability.** `quereus-plugin-nativescript-sqlite` must be present on device; fail gracefully if the platform build lacks it.

Prereq / depends on: `feat-portfolio-app-wiring` (portfolio runtime plumbing), and benefits from `feat-taleus-node-service` for reliable lifts. Parked in backlog until the app toolchain choice is confirmed and the portfolio wiring is ready.
