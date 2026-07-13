description: The two GitHub libraries Taleus needs for lift routing and its shared cryptography (ChipNet and ChipCryptBase) can't currently be installed as project dependencies — someone needs to decide how to make them consumable before the transport ticket can wire them in.
files: package.json, tickets/implement/3-feat-chipnet-transport.md
difficulty: easy
----

`feat-taleus-lib-scaffolding` (this repo's first buildable package) needed to add `chipnet` and `chipcryptbase` as dependencies per its ticket. Both are real, maintained libraries at `github.com/gotchoices/ChipNet` and `github.com/gotchoices/ChipCryptBase` (same author as this repo, MIT-licensed), and `docs/architecture.md` already describes ChipNet as "`chipnet` on npm" — but **neither package is actually published to the public npm registry**, and installing them directly from GitHub does not work either. This blocks `feat-chipnet-transport` (queued next in `tickets/implement/`), which is the ticket that actually imports and uses them.

## What was tried, and why it fails

Both `npm install chipnet` and `npm install chipcryptbase` return a plain HTTP 404 from `registry.npmjs.org` — they were never `npm publish`-ed.

Installing straight from the GitHub repo (`npm install github:gotchoices/ChipNet#<commit>`, and the yarn-berry equivalent) also fails, for a more fundamental reason: neither repo commits its compiled output. `dist/` is in `.gitignore`, `package.json`'s `main` field points at `./dist/index.js`, and there is no `prepare` (or similar) lifecycle script that would build it on install. So even when the install step itself succeeds, the resulting package has no `dist/` folder and is not importable — confirmed by hand: installing `chipcryptbase` from its GitHub `master` via yarn reports success, but the installed package directory contains only `LICENSE`, `package.json`, and `readme.md` — no `dist/`.

`ChipNet` fails one step earlier: it has a devDependency on `chipcode` (another `gotchoices` package), which is *also* unpublished, so npm/yarn's own bootstrap-from-git-source step 404s before it can even attempt a build.

In short: as they stand today, these two repos are not consumable as a package-manager dependency by any normal means (registry install, GitHub install, or lockfile-driven bootstrap). This is upstream of Taleus — nothing in this repo can fix it.

## Decision needed

Someone with authority over the `gotchoices/ChipNet` and `gotchoices/ChipCryptBase` repos (and, if it's ever actually needed as a runtime dependency rather than just a build-time one, `gotchoices/ChipCode`) needs to choose a fix. Options, roughly cheapest first:

1. **Publish them to npm** (`npm publish` from each repo, at their current versions — `chipnet` is at `0.1.7`, `chipcryptbase` at `0.1.15`). This matches what `docs/architecture.md` already assumes, is the least amount of new infrastructure, and is a normal `npm publish` run — nothing about the source needs to change. A one-time credential/access question: whoever runs this needs npm publish rights for these package names.
2. **Add a `prepare` script and stop gitignoring `dist/`... or fix `prepare`.** Would make plain git-URL dependencies work without a registry at all, but is more upstream repo churn than option 1, and doesn't remove the separate `chipcode` 404 (which would need the same fix, or removing it from ChipNet's devDependencies if it's test-only — it is, confirmed only used in `test/transaction.test.ts`, not in ChipNet's own `src/`).
3. **Vendor them into this repo** (e.g. a git submodule per package, mirroring how `tess/` is already consumed here, plus a local build step wired into Taleus's own install/build). Fully within Taleus's control and needs no upstream change, but is meaningfully more infrastructure than a `feat-chipnet-transport`-sized ticket should take on, and every consumer of ChipNet elsewhere would still hit the same wall.

## What already landed without this

`feat-taleus-lib-scaffolding` shipped the buildable TypeScript package (`package.json`, `tsconfig.json`, `jest.config.ts`, `eslint.config.js`) and a platform-neutral `src/crypto/` module (sha256 + ed25519 via `@noble/hashes` / `@noble/curves`, chosen so it matches what `docs/architecture.md` requires ChipNet's and the Quereus schema's signature primitives to agree on) — all working, `yarn build`/`yarn test`/`yarn lint` green, with no dependency on `chipnet`/`chipcryptbase` at all. `chipnet` and `chipcryptbase` were deliberately **not** added to `package.json`, since doing so would currently break `yarn install` outright for every contributor. Once this ticket is resolved, `feat-chipnet-transport` is the ticket that actually needs and wires them in.
