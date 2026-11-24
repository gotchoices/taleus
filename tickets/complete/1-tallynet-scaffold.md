description: Reviewed the new TallyNet lift-routing library's foundation — the package skeleton plus six small cryptographic and timing building blocks — and fixed one validation gap in the canonical digest.
files: packages/tallynet/src/digest.ts, packages/tallynet/src/digest.test.ts, packages/tallynet/src/session-code.ts, packages/tallynet/src/base64url.ts, packages/tallynet/src/crypto.ts, packages/tallynet/src/nonce.ts, packages/tallynet/src/sequencing.ts, packages/tallynet/src/rule.ts, packages/tallynet/src/no-node-globals.test.ts, packages/tallynet/docs/design.md
----

# TallyNet scaffold — review complete

The scaffold (buildable/tested `packages/tallynet` + six shared primitives for the later discovery and
consensus engines) was reviewed adversarially against the implement-stage diff (commit `1208757`). No lift
state-machine code exists yet — that is by design, deferred to tickets `2-tallynet-discovery` and
`3-tallynet-consensus`.

**Gates (re-run after the fix below):** `yarn workspace tallynet build && … lint && … test` — all green,
**72 tests / 8 suites** (was 71; +1 regression test). Root `yarn build` — green.

## Review findings

### Fixed inline (minor)

- **`digest.ts` — sparse-array hole bypassed the pre-check contract.** `assertEncodable`'s array branch
  used `Array.prototype.forEach`, which *skips holes*. A sparse array (`[1, , 3]`) therefore slipped past
  the module's own validator and threw from deep inside the dag-cbor encoder
  (`undefined is not supported by the IPLD Data Model`) instead of the documented, path-carrying error.
  The digest's load-bearing property (no silent/ambiguous preimage) was never at risk — the value was
  still rejected — but the behaviour contradicted the docstring ("Throws … before touching the encoder,
  with a path … `undefined`") and diverged from how an *explicit* `[1, undefined, 3]` is handled.
  **Fix:** indexed iteration, so a hole reads as `undefined` and is rejected here with its path. Pinned by
  a new regression test. design.md needs no change — the fix makes its existing claim truer, not false.

### Tripwires recorded (conditional — parked at the site, not ticketed)

- **Out-of-range bigint.** A `bigint` ≥ 2⁶⁴ is rejected by the dag-cbor encoder, not by `assertEncodable`,
  so its error carries no path. Harmless today — amounts cross TallyNet as decimal strings, never as a bare
  bigint this large. Parked as a `NOTE:` at the `bigint` case in `digest.ts` with the guard to add if a
  record ever carries one.
- **Rule-engine dependency order-dependence** (carried over from implement). Two ChipNet-faithful,
  order-dependent quirks in `rule.ts` (a freshly-skipped vs memoised-skipped dependency; dependency-failure
  only propagating on lazy evaluation). Already parked as a `NOTE:` at the `else if (!results.get(depName))`
  site and pinned by two tests in `rule.test.ts`. Unused (no real `RuleSet` exists), so genuinely a
  tripwire; the discovery/consensus tickets that build the first real rule sets decide whether to normalise
  it — that would be a deliberate behaviour change, not a scaffold fix.
- **`no-node-globals.test.ts` uses `readdirSync(…, { recursive: true })`** (Node ≥ 18.17) while the package
  `engines` says `node >= 18`. Test-infrastructure only, CI node is controlled; noted in case of an older
  runner. Not worth a code change now.

### Checked and verified sound (no action)

- **Digest preimage safety** (the load-bearing claim — signatures ride on it): injective, self-delimiting,
  key-order independent; `{a:'bc'}`≠`{ab:'c'}`, array≠object-with-index-keys; rejects undefined (incl.
  nested, with path), function, symbol, non-finite, non-plain prototype (Date/Map). Probed extra cases: a
  throwing getter propagates its error (acceptable — exceptional, not swallowed); `-0` digests as `0`
  (harmless); accepts null-prototype objects and `Uint8Array` leaves. DAG-CBOR key sorting confirmed by the
  order-independence test. `number`===`bigint` equal-value digest is intentional, documented, tested, and
  harmless (amounts are strings).
- **Session code** boundaries: valid strictly before expiry (expiry == `now` counts as expired); far-future
  expiry rejected by the `DEFAULT_MAX_TTL_MS` (1 h) ceiling unless widened; all-zero rejected;
  malformed/short/non-canonical base64url rejected. Probed an expiry decoding past `Number.MAX_SAFE_INTEGER`:
  `expiresAt` loses precision there, but such a code is harmlessly refused by `isValid`'s TTL ceiling, so the
  gate holds.
- **base64url**: strict canonical decode (re-encode equality check) rejects non-alphabet chars and
  non-canonical trailing bits; round-trips 0–40-byte inputs; empty string ↔ empty array.
- **budgetedStep / Pending**: no leaked timer on any exit path (early-complete, complete-during, budget,
  abort, already-aborted, empty set — all assert `getTimerCount() === 0`); abort listener removed in
  `finally`. Reasoned through the "request settles after the step already resolved" angle: `resolve()` is
  idempotent and the timer is already cleared, so a late settlement is a harmless no-op — no throw, no rearm.
- **Rule engine**: faithful ChipNet port, retyped off `any`; missing/failed/skipped/thrown paths all tested.
- **Crypto ports**: `CryptoProviderLike` (sha256/sign/verify) is a clean structural subset of
  `taleus-core`'s `CryptoProvider` (confirmed at this SHA — the compile-time `asPortProvider` assignment
  holds); `KeyPairLike` matches `KeyPair`. No default `Signer`/`Verifier` by design (no curve lib dep);
  ed25519 is the host's to inject at the binding step.
- **Nonce**: byte-for-byte preimage parity with `taleus-core`'s `computeNonce`
  (`chipnet-protocol.ts:222`) confirmed — identical length-prefixed layout. The *text encoding* diverges
  (TallyNet base64url vs taleus-core standard base64); this is deliberate and anchored —
  `plan/4-tallynet-bind-taleus-core` unifies both on TallyNet's single `makeNonce`. Not a bug now: the two
  functions are not wired together yet and must not be compared as strings until binding.
- **Platform neutrality**: enforced two ways — the `types: []` build refuses `Buffer`/node imports at
  compile time, and `no-node-globals.test.ts` greps every non-test source file. Build green under `types: []`.
- **Docs**: design.md (§ Canonical encoding, § The seam, § Scope and boundaries) read in full and accurately
  reflect the shipped code.

### Major findings → new tickets

None. No defect warranting a fix/plan/backlog ticket surfaced; the discovery and consensus engines that will
exercise these primitives are already queued as `plan/2-tallynet-discovery` and `plan/3-tallynet-consensus`.

## Pre-existing failures

None. All gates were green before and after the one inline fix.
