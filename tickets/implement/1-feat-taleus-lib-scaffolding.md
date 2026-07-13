----
description: Create the actual Taleus code project (a TypeScript library) so the lift agent and its pieces have somewhere to live — today the repo is only design docs and database schema, with no buildable code.
prereq:
files: package.json (new), tsconfig.json (new), jest.config.ts (new), src/ (new), docs/architecture.md (§ The Stack, § Client Application)
difficulty: easy
----

First real code in Taleus. Until now the repo is design-phase: `docs/`, `schema/*.qsql`, and `tickets/` only — no `package.json`, no `src/`, no build. Every lift-subsystem ticket (`feat-lift-conversion-helper`, `feat-chipnet-transport`, `feat-lift-agent-discovery`, `feat-lift-referee-commit`) needs a project to build in. This ticket creates it and nothing more.

Constraints from `AGENTS.md`: **TypeScript + ES Modules, yarn, platform-neutral** (the library must run in Node — headless agent — the browser, and NativeScript; no Node-only APIs in the core). Match `.editorconfig` (tabs). Svelte Native app scaffolding is **out of scope** — this is the platform-neutral library package only.

## Shared crypto primitives (the one non-trivial part)

`docs/architecture.md` § *Referee model and the commit seam* states a hard cross-subsystem constraint: the referee's per-edge signature must verify **both** inside ChipNet (`CryptoHash`/`Asymmetric` from `chipcryptbase`) **and** inside the Quereus schema (`Digest()` / `SignatureValid()` in `schema/draft1.qsql`). So both must use the **same hash (sha256) and the same signature scheme (ed25519)**. Establish a single `src/crypto/` module now that exports the primitives, so downstream tickets and the eventual Quereus scalar-function registrations bind to one implementation. Do **not** invent two.

Add dependencies: `chipnet`, `chipcryptbase` (ChipNet's crypto base). Do **not** wire `@serfab/cadre-core` / the Quereus Sereus plugin here — those are transport/runtime concerns pulled in by `feat-chipnet-transport`. Keep this package installable and `yarn build` / `yarn test` green with an empty-but-present test.

## Edge cases & interactions

- **Platform neutrality.** No `node:crypto`-only imports leaking into the core surface — the crypto module must have a browser/NativeScript path (or a documented injection seam). ChipNet's own `participant.ts` imports `crypto` (Node); the Taleus core must not inherit that as a hard Node dependency in browser builds. Name the seam.
- **ESM interop.** ChipNet ships ESM (`"exports"` map, `.js` specifiers). Ensure `tsconfig`/`jest` are ESM-correct (ChipNet's own `NODE_OPTIONS='--experimental-vm-modules'` jest posture is a reference).
- **Version pinning.** Pin `chipnet` (currently `0.1.7`) and `chipcryptbase` to exact/known-good versions; ChipNet is pre-1.0 and its API can move.
- **No schema coupling yet.** This ticket does not execute `.qsql`; it only fixes the crypto algorithm choice that the schema will later be made to match.

## TODO

- Create `package.json` (ESM, yarn, `build`/`test`/`lint` scripts), `tsconfig.json`, `jest.config.ts`, `.eslintrc` consistent with `.editorconfig`.
- Add deps `chipnet`, `chipcryptbase` (pinned).
- Create `src/index.ts` and `src/crypto/` exporting sha256 digest + ed25519 sign/verify, with a documented platform-injection seam and no hard Node-only import in the core path.
- Add one trivial passing test; confirm `yarn build` and `yarn test` are green (stream output with `tee`).
