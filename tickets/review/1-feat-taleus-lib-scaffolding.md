description: The first buildable code in Taleus now exists — a TypeScript library project with a working build/test/lint pipeline and a shared sha256+ed25519 crypto module — ready for a review pass before other lift-subsystem work builds on it.
files: package.json, tsconfig.json, tsconfig.build.json, jest.config.ts, eslint.config.js, .yarnrc.yml, src/index.ts, src/crypto/provider.ts, src/crypto/noble-provider.ts, src/crypto/index.ts, src/crypto/crypto.test.ts
difficulty: easy
----

## What landed

A yarn/ESM TypeScript package at the repo root: `package.json`, `tsconfig.json` (+ `tsconfig.build.json` for the `dist` build, excluding tests), `jest.config.ts`, `eslint.config.js` (ESLint 10 flat config), `.yarnrc.yml` (`nodeLinker: node-modules` — see *Decisions* below). `yarn build`, `yarn test`, and `yarn lint` are all green from a clean `yarn install`.

`src/crypto/` is the one substantive piece: a platform-neutral sha256-digest + ed25519-sign/verify module, because `docs/architecture.md` § *Referee model and the commit seam* requires ChipNet's referee signature and the Quereus schema's `Digest()`/`SignatureValid()` to agree on exactly one hash and one signature scheme — this module is that one implementation.

- `src/crypto/provider.ts` — the `CryptoProvider` interface (`sha256`, `generateKeyPair`, `sign`, `verify`) and `KeyPair` type. This is the **platform-injection seam**: a future NativeScript keychain/secure-enclave-backed implementation (or anything else) is a second object satisfying this interface.
- `src/crypto/noble-provider.ts` — the default `CryptoProvider`, backed by `@noble/hashes` (sha256) and `@noble/curves` (ed25519). Both are pure JS with zero `node:crypto` or other platform-specific imports (verified by unpacking both tarballs and grepping for `node:crypto`/`require('crypto')` — no hits), so this default runs unchanged in Node, the browser, and NativeScript; the seam exists for future flexibility, not because the default needs one.
- `src/crypto/index.ts` — module-level `getCryptoProvider`/`setCryptoProvider` plus top-level `sha256`/`generateKeyPair`/`sign`/`verify` convenience functions that delegate to whichever provider is current (defaults to the noble one).
- `src/crypto/crypto.test.ts` — one test: generate a key pair, sign a digest, confirm `verify` accepts the correct digest+signature and rejects a different digest under the same signature.
- `src/index.ts` — re-exports `./crypto`.

Package `exports` map exposes `"."` (root) and `"./crypto"`, each with an explicit `"types"` condition (needed because `moduleResolution: NodeNext` otherwise won't reliably find `.d.ts` files through a conditional-exports map). Future subsystem tickets (`feat-lift-conversion-helper` → `src/lift/`, `feat-chipnet-transport` → `src/transport/`, …) will each need their own `exports` entry added the same way — that's a deliberate explicit-over-clever choice, not an oversight.

## How to validate

```
yarn install
yarn build   # tsc -p tsconfig.build.json -> dist/
yarn test    # NODE_OPTIONS=--experimental-vm-modules jest (via cross-env)
yarn lint    # eslint ./src
```

All four are green as of this handoff. Also spot-checked by hand that the *compiled* output actually works end-to-end (not just that `tsc` didn't error): ran a plain Node ESM script importing `./dist/index.js` directly, generating a key pair, signing a digest, and verifying it — round-tripped correctly (32-byte sha256 digest, 32-byte ed25519 public key, 64-byte signature).

## Decisions worth knowing about

- **`typescript` pinned to `6.0.3`, not the current `7.0.2` latest.** `ts-jest@29.4.11` declares `typescript: ">=4.3 <7"` and `typescript-eslint@8.63.0`'s parser declares `typescript: ">=4.8.4 <6.1.0"` — TS 7 (and TS 6.1+) isn't yet supported by this toolchain. `6.0.3` is the newest version inside both ranges.
- **`.yarnrc.yml` sets `nodeLinker: node-modules`**, overriding Yarn 4's Plug'n'Play default. PnP is a poor fit here: Jest/ts-jest and (per `docs/architecture.md`) NativeScript's Metro-style bundler both expect a real `node_modules` tree.
- **ESLint 10 requires flat config** (`.eslintrc.json` is no longer read by default as of ESLint 9) — used `eslint.config.js` with the `typescript-eslint` meta-package and ESLint core's `defineConfig()` (the currently-recommended API; `tseslint.config()` is now deprecated in favor of it). Type-aware rules are on (`parserOptions.projectService`), so `@typescript-eslint/no-floating-promises` etc. actually see type information.
- **`@typescript-eslint/no-explicit-any` set to `error`**, matching `AGENTS.md`'s "Not type lazy — avoid `any`".

## Known gap — chipnet / chipcryptbase not wired in

The ticket asked to add `chipnet` and `chipcryptbase` as dependencies. **They are deliberately not in `package.json`.** Verified hands-on that neither is currently installable by any normal path:

- Neither is published to the npm registry (plain 404 from `registry.npmjs.org` for both).
- Installing directly from GitHub also fails to produce a usable package: both repos gitignore their `dist/` output and have no `prepare`/build-on-install script, so even a "successful" git-dependency install yields a package with no `dist/` — confirmed by hand for `chipcryptbase` (installed cleanly via `yarn add chipcryptbase@github:...`, but `node_modules/chipcryptbase` contains only `LICENSE`/`package.json`/`readme.md`, no `dist/`). `chipnet` fails even earlier: its devDependency `chipcode` is *also* unpublished, so npm/yarn's own git-bootstrap step 404s before any build is attempted.

Adding them as-is would break `yarn install` for every future contributor, which would have violated this ticket's own "keep the package installable" requirement. Filed as `tickets/blocked/chipnet-npm-publish-needed.md` — needs a human decision on the fix (publish to npm is the recommended, lowest-effort option; docs already assume `chipnet` is "on npm"). This blocks `feat-chipnet-transport` (the next queued implement ticket, which is where these packages actually get imported and used) but not the two tickets ahead of it in practice — `feat-lift-conversion-helper` is pure math with no ChipNet dependency.

## Test coverage floor — be aware

The one test covers the sign/verify round trip and a tampered-digest rejection. It does **not** cover: `setCryptoProvider`/`getCryptoProvider` injection (untested — no second provider exists yet to swap in), digest determinism (same input → same sha256 output, never actually asserted), or empty/edge-case inputs. Treat this as a floor, not a ceiling.
