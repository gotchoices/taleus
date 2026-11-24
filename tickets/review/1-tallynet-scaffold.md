description: Review the new TallyNet lift-routing library's foundation — the package skeleton plus six small cryptographic and timing building blocks — for correctness and honesty of its tests.
files: packages/tallynet/package.json, packages/tallynet/tsconfig.json, packages/tallynet/tsconfig.build.json, packages/tallynet/jest.config.ts, packages/tallynet/src/globals.d.ts, packages/tallynet/src/base64url.ts, packages/tallynet/src/crypto.ts, packages/tallynet/src/session-code.ts, packages/tallynet/src/nonce.ts, packages/tallynet/src/digest.ts, packages/tallynet/src/sequencing.ts, packages/tallynet/src/rule.ts, packages/tallynet/src/index.ts, packages/tallynet/docs/design.md, packages/taleus-core/src/transport/chipnet-protocol.ts
----

# TallyNet scaffold — review handoff

TallyNet (`packages/tallynet`) is the port of ChipNet into this repo: route discovery + atomic lift commit, platform-neutral, importing nothing from this repo. This ticket built the **scaffold** — the buildable/tested package plus the six shared primitives the discovery (ticket 2) and consensus (ticket 3) engines will sit on. **Nothing in the lift state machines is built yet; that is by design.**

Treat the code as a starting point and the tests as a floor, per the review stage's charter. The honest-gaps section below is where to aim adversarial attention.

## What was built

| Module | Exports | Notes |
|---|---|---|
| `src/crypto.ts` | `Hasher`, `Signer`, `Verifier`, `RandomSource` interfaces; `nobleHasher`, `webRandomSource` defaults; `providerHasher`/`providerSigner`/`providerVerifier` adapters + `CryptoProviderLike` | No default `Signer`/`Verifier` — ed25519 lives in `@noble/curves`, which TallyNet deliberately does **not** depend on (runtime deps are only `@noble/hashes` + `@ipld/dag-cbor`). Host injects signing. |
| `src/session-code.ts` | `generate`, `expiresAt`, `isExpired`, `isValid`, `isWellFormed`, `SESSION_CODE_BYTES/LENGTH`, `DEFAULT_MAX_TTL_MS` | 32 bytes = 8-byte big-endian ms expiry ‖ 24 random, base64url (43 chars). Clock injected. |
| `src/nonce.ts` | `makeNonce(sessionCode, linkId, hasher?)` | `base64url(sha256(len32(session) ‖ session ‖ link))`. |
| `src/digest.ts` | `digest`, `canonicalEncode`, `DigestValue` | Deterministic DAG-CBOR + sha256. Rejects undefined/function/symbol/non-finite/non-plain-prototype with a JSON path. |
| `src/sequencing.ts` | `Pending<T>`, `budgetedStep`, `BudgetedStepOptions` | ChipNet port + the two review-noted fixes: timer always cleared; abort signal. |
| `src/rule.ts` | `Rule`, `RuleSet`, `checkRules`, `RuleResponse`, `RuleResult` | ChipNet port, retyped off `any`. |
| `src/base64url.ts` | `bytesToBase64url`, `base64urlToBytes` | Internal, strict canonical decode. |

## Validation already run (the floor)

- `yarn workspace tallynet build && yarn workspace tallynet test && yarn workspace tallynet lint` — green. **71 tests, 8 suites.**
- Root `yarn build` — green.
- `yarn install` ran; `@ipld/dag-cbor@11.0.0` + `cborg@7.0.0` landed in `yarn.lock`, tallynet workspace registered.
- Platform neutrality enforced **two ways**: the build (`tsconfig.build.json`, `types: []`) refuses `Buffer`/node imports at compile time, and `src/no-node-globals.test.ts` greps every non-test source file for `Buffer` usage, `node:`/built-in imports and `require(`.

## Where to push (suggested adversarial angles)

- **Digest preimage safety** is the load-bearing claim (signatures ride on it). Verified: key-order independence, `{a:'bc'}`≠`{ab:'c'}`, `[1,2]`≠`{0:1,1:2}`, nested-`undefined` rejection, Uint8Array leaf. Try: deeply nested structures; a plain object whose key is itself a stringified index; very large bigints; an array containing a hole (`[1,,3]`); a getter that throws.
- **Session code** boundaries: expiry exactly at `now` (counts as expired — valid strictly before); far-future expiry rejected by `DEFAULT_MAX_TTL_MS` (1h) unless widened; all-zero code rejected; malformed/short/non-canonical base64url rejected. Try: a code whose expiry decodes to > `Number.MAX_SAFE_INTEGER`; negative/NaN `now`.
- **budgetedStep** leaked-timer guarantee: tests assert `jest.getTimerCount() === 0` after every exit path (early-complete, complete-during, budget-elapsed, abort, already-aborted, empty set). Try: a request that settles *after* the step already resolved (should not throw / rearm).
- **Rule engine**: see the quirk under honest gaps — confirm the pinned tests match intended semantics or file a normalisation ticket.

## Honest gaps / things reviewers must know

1. **Nonce encoding diverges from `taleus-core` today (decided "change both").** `makeNonce` uses **base64url**; `taleus-core`'s `computeNonce` (`src/transport/chipnet-protocol.ts:222`) still uses **standard padded base64**. The *preimage byte layout is identical*; only the text encoding differs. Per the ticket's "match byte-for-byte **or** change both and say so", I changed TallyNet to base64url (its house encoding, URL-safe) and deliberately did **not** touch `taleus-core` yet, so the app-side branch keeps building (design.md § The seam, "rename happens in the binding step, not before"). The binding ticket (`4-tallynet-bind-taleus-core`) must unify them by having the transport import `makeNonce`; until then the two must not be compared as strings. **Not a bug now** (the functions aren't wired together yet) — a required binding-step action, noted in `nonce.ts`'s header.

2. **Rule engine dependency semantics are ChipNet-faithful and quirky (tripwire, parked as a `NOTE` in `rule.ts` + two pinned tests).** Two order-dependent behaviours preserved as-is: (a) a dependency found *already-skipped* in the memo skips the dependent, but one *freshly* evaluated to skipped does not; (b) `Dependency failed:` only propagates when the dependency is evaluated lazily — a dependency ordered *earlier* in the array (already memoised as failed) does **not** fail its dependent. This is upstream behaviour; the ticket said "port as is". It is currently **unused** (no real RuleSet exists yet), so it is a tripwire, not a latent defect. The discovery/consensus tickets that build the first real RuleSets should decide whether to normalise it; if they do, that is a deliberate behaviour change, not a scaffold fix. Index entry for the reviewer's findings: *noticed the rule-dependency order-dependence; parked as `NOTE` at the `else if (!results.get(depName))` site in `rule.ts` and pinned by tests in `rule.test.ts`.*

3. **`bigint` and `number` of equal value produce the same digest** (DAG-CBOR encodes both as the same CBOR integer). Documented in `digest.ts` and design.md, pinned by a test. Harmless given amounts travel as decimal strings, but a reviewer should confirm no later code signs a bare integer where the number/bigint distinction would matter.

4. **`Signer`/`Verifier` compatibility with `taleus-core` is proven structurally, not by import.** `crypto.test.ts` builds a `CoreCryptoProvider`-shaped double (shape copied, never imported — the dependency only points the other way) and shows it satisfies `CryptoProviderLike` and that the adapters round-trip. It does **not** exercise real ed25519 (no curve lib here); that is validated at binding against `taleus-core`'s `nobleCryptoProvider`. Confirm the `CryptoProviderLike` shape still matches `taleus-core`'s `CryptoProvider` (`src/crypto/provider.ts`) — it does at this SHA.

5. **No cross-check digest vectors with `taleus-core`'s `digest.ts`.** The testing-approach note asked for this "where they overlap"; they don't overlap — `taleus-core`'s digest is the storage stack's framed tuple encoding over a fixed settlement tuple, a different format for a different input. Instead, `digest.test.ts` pins TallyNet's own DAG-CBOR byte vectors (`a1616101` for `{a:1}`, etc.) so a dependency bump that changes the encoding is caught. Documented in the test header.

6. **A `yarn install` peer-dependency warning** (`YN0086`) appeared; it is not specific to tallynet's direct deps and did not fail any gate. Worth a glance if the reviewer is auditing the lockfile.

7. **Coverage is unit-level only.** The design's "simulated network" and "adversarial consensus" harnesses belong to the discovery/consensus tickets and are not here. The grep test (`no-node-globals.test.ts`) uses `readdirSync(..., { recursive: true })` (Node ≥ 18.17); fine for CI, noted in case of an older runner.
