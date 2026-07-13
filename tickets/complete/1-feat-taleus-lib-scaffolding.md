description: Taleus's first buildable code — a TypeScript library with a green build/test/lint pipeline and a shared sha256+ed25519 crypto module — reviewed and confirmed correct, cross-platform, and algorithm-pinned.
files: package.json, tsconfig.json, tsconfig.build.json, jest.config.ts, eslint.config.js, .yarnrc.yml, src/index.ts, src/crypto/provider.ts, src/crypto/noble-provider.ts, src/crypto/index.ts, src/crypto/crypto.test.ts
----

## What landed

A yarn/ESM TypeScript package at the repo root, plus a platform-neutral `src/crypto/` module (sha256 digest + ed25519 sign/verify) behind a `CryptoProvider` injection seam, defaulting to `@noble/hashes` / `@noble/curves` (pure JS, no `node:crypto`). See the implement commit `0b5755c` and the review commit for full detail. `yarn build`, `yarn test`, `yarn lint` all green from a clean install.

The one requirement the crypto module exists to satisfy: `docs/architecture.md` § *Referee model and the commit seam* ("Cross-primitive constraint") requires ChipNet's referee signature and the Quereus schema's `Digest()`/`SignatureValid()` to agree on exactly one hash (sha256) and one signature scheme (ed25519). This module is that single shared implementation.

## Review findings

**Verdict: sound.** Code is correct, cross-platform, and now algorithm-pinned. One minor gap (thin tests) fixed inline; one known gap already correctly parked in `blocked/`.

- **Build / test / lint** — all three green before and after review. Ran the KAT + round-trip end-to-end against the *compiled* `dist/` (not just `tsc`): `sha256("")` = `e3b0…b855` and `sha256("abc")` = `ba78…15ad` match the standard sha256 vectors; ed25519 key/sig sizes are 32/32/64 bytes; tampered digest **and** tampered signature both rejected.

- **Correctness scan** — noble argument order verified: `sign(message, secretKey)` and `verify(signature, message, publicKey)` are wired correctly in `noble-provider.ts` (the interface flips digest/secretKey order for readability, and the adapter maps it right). No `any`, no floating promises, strict TS, tabs per `.editorconfig`. Nothing found.

- **Cross-primitive constraint (the module's whole purpose)** — the digest must stay byte-identical to what Quereus recomputes. Confirmed the default is *standard* sha256 via known-answer vectors, and locked it: the implement test only did a sign/verify round trip, so a future provider swap could have silently changed the hash with a green suite.

- **Test coverage — FIXED INLINE (minor).** Expanded `crypto.test.ts` from 1 test to 6: added sha256 known-answer vectors, digest determinism, tampered-signature rejection, ed25519 byte-length assertions, and a `setCryptoProvider`/`getCryptoProvider` injection round-trip (all restore the default in a `finally`). The implement handoff flagged exactly these as untested.

- **Docs** — checked `docs/architecture.md` against the change. Already accurate: it says the shared hash/signature primitives are "wired once at library setup", which is precisely the `setCryptoProvider` seam this module provides. No doc update needed.

- **Known gap: chipnet / chipcryptbase not wired in** — the implement ticket asked to add these as deps; they are correctly **absent** because neither is installable today (unpublished to npm; GitHub install yields no `dist/`). Properly filed to `tickets/blocked/chipnet-npm-publish-needed.md` (a human decision on how to make them consumable). Correct disposition — no action in this pass. Blocks `feat-chipnet-transport`, not the scaffolding.

- **Tripwire — lint scope.** `yarn lint` runs `eslint ./src` only, so config files (`eslint.config.js`, `jest.config.ts`) are not linted. Harmless now (they're small, hand-maintained config). If config TS grows or a `scripts/` dir appears, widen the lint glob. Not filed — recorded here only.

- **Empty categories** — no major findings (nothing warranting a new fix/plan ticket), no error paths beyond the sign/verify rejection cases (the API surface is four pure functions + a provider setter; no I/O, no async, no resource cleanup to leak). No regressions possible — this is the first code in the package.
