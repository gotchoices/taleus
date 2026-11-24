description: Create the buildable, tested skeleton of the new lift-routing library (TallyNet) with the small cryptographic and timing building blocks everything else in it needs.
files: packages/tallynet/, packages/tallynet/docs/design.md, packages/tallynet/docs/chipnet-review.md, packages/taleus-core/package.json, packages/taleus-core/tsconfig.json, packages/taleus-core/src/crypto/, packages/taleus-core/src/transport/chipnet-protocol.ts
difficulty: medium
----

TallyNet (`packages/tallynet`) is the port of ChipNet into this repo. Read `packages/tallynet/docs/design.md` (§ Scope and boundaries, § Package conventions) and skim `docs/chipnet-review.md` first. Upstream source for reference: a ChipNet checkout at `../chipnet` (commit `29fbc24`; see design.md § Working with the upstream source). Port behaviour, not code style.

## Build

- `packages/tallynet/package.json`: name `tallynet`, `"type": "module"`, exports `.` → `dist/index.js` + types, scripts `build`/`test`/`lint` matching `packages/taleus-core`. Runtime deps limited to `@noble/hashes` and the canonical encoder (below); no `chipcryptbase`, no Node built-ins. Run `yarn install` so the workspace lands in `yarn.lock`.
- `tsconfig.json`, `jest.config.*` modelled on `taleus-core`.
- `src/index.ts` barrel (no internal imports through the barrel).

## Modules

- `src/crypto.ts`: the ports TallyNet needs, as interfaces: `Hasher` (sha256), `Signer` (`sign(digest) → signature`, `publicKey`), `Verifier` (`verify(publicKey, digest, signature) → boolean`, sync or async but **always awaited**), `RandomSource`. Default implementations on `@noble/hashes` + `globalThis.crypto.getRandomValues`. Check `taleus-core`'s `CryptoProvider` (`src/crypto/provider.ts`) can satisfy them without TallyNet importing taleus-core.
- `src/session-code.ts`: ChipCode's idea, re-implemented: a random code (32 bytes) carrying its own expiry; `generate(ttlMs)`, `isValid`, `isExpired(now)`, `expiresAt`. Encoding is up to you (e.g. 8-byte big-endian ms expiry + 24 random bytes, base64url). Inject the clock. Drop ChipCode's statistical randomness tests on *our own* codes (we generate them); keep a cheap sanity check (length, format, not-all-zero) for codes received from peers.
- `src/nonce.ts`: `makeNonce(sessionCode, linkId)` = base64url(sha256(sessionCode ‖ linkId)) with an unambiguous separator or length prefix. Match `computeNonce` in `taleus-core/src/transport/chipnet-protocol.ts:222` byte-for-byte, or change both and say so in the handoff.
- `src/digest.ts`: canonical digest of an arbitrary JSON-like value (+ bigint) per design.md § Canonical encoding. Default: deterministic CBOR via `@ipld/dag-cbor`, sha256. Record the choice in design.md. Reject `undefined`, functions, non-finite numbers.
- `src/sequencing.ts`: `Pending<T>` and `budgetedStep(budgetMs, requests)`. Port from ChipNet, but **clear the timer** when the step ends early, and accept an abort signal.
- `src/rule.ts`: ChipNet's `RuleSet` (named async rules with dependencies and conditions). Port as is, with tests.

## Edge cases & interactions

- Session code: expiry exactly at `now`; clock skew (a code from a peer whose expiry is far in the future should be rejected above a configurable max TTL); malformed base64; wrong length.
- Nonce: two different `(sessionCode, linkId)` pairs whose plain concatenation is equal must give different nonces.
- Digest: key order doesn't matter; `{a:'bc'}` ≠ `{ab:'c'}`; `[1,2]` ≠ `{0:1,1:2}`; bigint ≠ number of the same value (or document that they are equal); nested `undefined` rejected.
- `budgetedStep`: all complete before budget (returns early, no timer left; jest must exit without "worker failed to exit"); none complete; a request that rejects counts as complete; empty request set.
- Runs without Node globals: no `Buffer`, no `crypto` import (lint rule or test that greps `src/`).

TODO
- Scaffold package; `yarn install`; `yarn workspace tallynet build && yarn workspace tallynet test && yarn workspace tallynet lint` green; root `yarn build` still green.
- Implement and test the six modules above.
- Update `packages/tallynet/README.md` status line and design.md (encoding choice).
- Add `packages/tallynet` to the package list in the root `AGENTS.md` (Repo orientation).
