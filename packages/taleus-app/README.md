# taleus-app

The Taleus **client application(s)** — TypeScript. The app *is* a peer: it embeds a
Sereus cadre node (`@serfab/cadre-core`, strand filter `sAppId:taleus`) directly and
the `taleus` library for tally logic, negotiation, and a best-effort lift agent while
the phone is awake.

App surfaces (see [`docs/architecture.md`](../../docs/architecture.md#client-application)):
tally list + balances, formation (QR invite/scan), negotiation, payments/invoices,
lift activity, and cadre management (delegated to Sereus UX patterns).

Reliable lift participation comes from adding an always-on
[`taleus-node`](../taleus-node) to the cadre; the phone is push-woken for the
commit window when it has no always-on node.

## Layout (appeus-managed)

This package is an [Appeus](appeus/README.md) project: design artifacts are authored
here and app code is generated per target.

- `design/specs/project.md` — project decisions (purpose, platforms, toolchain, data strategy)
- `design/stories/<target>/` — user stories per target
- `design/specs/<target>/` — screens, components, navigation, per-target STATUS
- `design/generated/<target>/` — AI consolidations, scenarios, screenshots
- `apps/<target>/` — generated app scaffold (framework code)
- `AGENTS.md` / `CLAUDE.md` — appeus agent rules (symlinks into the toolkit, git-ignored)

Framework is not yet chosen — that decision belongs in `design/specs/project.md`.
Candidates: React Native, or NativeScript + Svelte (the earlier assumption, modeled on
the Sereus reference app `../../../sereus/packages/reference-app-ns`).

## Status

No target scaffolded yet. Discovery phase: fill in `design/specs/project.md`, then
`./appeus/scripts/add-app.sh --target <target> --framework <framework>`.

Note: a generated `apps/<target>/` is **not** covered by the root `workspaces: ["packages/*"]`
glob, so it installs its own dependencies unless enrolled deliberately.
