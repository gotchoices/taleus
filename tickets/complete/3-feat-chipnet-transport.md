description: The message-pipe layer that lets two people's devices exchange ChipNet's lift-discovery and commit messages over the network — built, tested, and reviewed, still awaiting the real ChipNet library (not yet installable).
files: src/transport/comms.ts, src/transport/chipnet-protocol.ts, src/transport/index.ts, src/transport/test-harness.ts, src/transport/comms.test.ts, src/transport/chipnet-protocol.test.ts, src/index.ts, tsconfig.build.json, docs/architecture.md (§ Transport, § Identity and address mapping, § Mobile and offline participation), tickets/blocked/chipnet-npm-publish-needed.md, tickets/implement/5-feat-lift-referee-commit.md
----

## What landed

The `/taleus/chipnet/1.0.0` message pipe between the two cadres of a tally, per `docs/architecture.md` § *Transport*. ChipNet is a meta-protocol — it never opens a socket, it calls host callbacks to move messages; this ticket implemented those callbacks (`queryPeer` discovery round-trip, `updatePeer` commit push) plus the inbound handler, the salted per-session nonce ↔ `linkId` map, and the identity/address resolution beneath them. Discovery search and commit logic are the *next two* tickets (`feat-lift-agent-discovery`, `feat-lift-referee-commit`); this built the pipe they run over.

- **`src/transport/comms.ts`** — dependency-free stream primitives: minimal libp2p 3.x stream/node ports and a 4-byte big-endian length-prefixed JSON frame codec (`writeFrame`/`readFrame`/`decodeLengthPrefixedFrame`/`withTimeout`/`readStreamToEnd`), byte-compatible with Sereus's control-network framing.
- **`src/transport/chipnet-protocol.ts`** — `ChipNetTransport`: `queryPeer`/`updatePeer`, the membership-gated inbound handler (reentrant, `maxConcurrent`-capped), the private `nonceToLinkMap`, the `computeNonce` derivation, and the registration seam (`registerResponder`/`registerParticipant`/`registerEdge`/`forgetEdge`).
- **`src/transport/test-harness.ts`** — in-memory `Chan`/duplex stream pair/`InMemoryNode`; excluded from the production build.
- Re-exported from `src/index.ts`.

ChipNet itself is **not bound** — `chipnet`/`chipcryptbase` remain unpublished (blocked on `chipnet-npm-publish-needed`, still HTTP 404 this run). The ChipNet message types are a local opaque-`body` port; the wire envelope stays unchanged when the packages land. `@serfab/cadre-core` was modeled as a typed host port (`ChipNetTransportHost`) rather than added as a hard dependency, to avoid the native-build (gyp) risk of the optimystic/libp2p/quereus tree on Windows while there is no end-to-end path to exercise it anyway.

`yarn build` / `yarn lint` / `yarn test` (38 tests, 4 suites) all green.

## Review findings

Read the implement diff (`2ff067a`) with fresh eyes before the handoff, scrutinized from every angle (framing/EOF handling, timeout/abort leaks, concurrency cap, membership gating, nonce privacy, type safety, resource cleanup, error paths), re-read every doc section the change touches, and ran lint + full tests.

**Fixed inline (real latent defect):**
- **`computeNonce` separator was a raw NUL byte (`0x00`) embedded in the `.ts` source** — the template literal was `` `${sessionCode}\0${linkId}` ``, not the space it rendered as. Two harms: (a) the NUL made the file classify as *binary* to grep, the code-search index, and diff tooling (ripgrep flagged it binary); (b) a single-byte delimiter (NUL or space) collides `("a b","c")` with `("a","b c")` — a nonce collision in a privacy primitive lets a peer conflate two tallies. Replaced with a length-prefixed concatenation (`u32be(len(session)) ‖ session ‖ link`), which is genuinely unambiguous and removes the NUL from source. Added a regression test asserting the boundary cannot shift. The exact byte layout is still provisional (must be reconciled with ChipNet's `AnonymityService` when it lands — `NOTE:` at the site); both Taleus sides run the same function so they agree regardless.

**Reviewer decisions the implement handoff asked for:**
- **Accept the `@serfab/cadre-core` typed-port approach** (not converting to a hard dependency now). The port is a 1:1 surface match with `CadreNode`; binding a real node is a thin adapter that belongs in the first ticket that stands one up. Converting now would buy nothing while ChipNet is unbindable and would risk the currently-green cross-platform install/build.
- **Accept the nonce-conditional `trx-record` membership gate** as designed (records may legitimately arrive ungated over a `C`-intent relay hop). The safety boundary is the downstream referee-signature check, so the participant contract was **carried into `tickets/implement/5-feat-lift-referee-commit.md`**: the registered `RecordParticipant` must verify the referee signature on every inbound record before acting, and must ingest idempotently.

**Tripwires parked (NOTE at site + noted here, not filed as tickets):**
- **`writeFrame` ignores `send()` backpressure return** — fine for ChipNet's small frames; only matters if frames approach `maxFrameBytes`. `NOTE:` at `comms.ts` `writeFrame`.
- **`updatePeer` push-wake retry can re-deliver a record** — the catch fires on any push failure including an application-level ack rejection, so the participant may see a record twice. `NOTE:` at the `updatePeer` catch; the idempotency requirement is also carried into ticket 5.
- **Carried from implement (still valid):** `nonceToLinkMap` grows until `forgetEdge` (agent-owned cleanup; leaks only if the downstream agent forgets to call it); cross-cadre commit-wake reach is a Sereus-layer question settled when a live node is stood up. Neither filed.

**Docs:** verified § *Transport*, § *Identity and address mapping*, § *Mobile and offline participation* against the code — accurate, no drift. The abstract `nonce = base64(sha256(sessionCode ‖ link))` in § *Identity and address mapping* still holds (the length prefix is one unambiguous encoding of that concatenation).

**Tests:** the implementer's 37 tests cover discovery round-trip, commit push, sleeping/unreachable-edge skip, dial timeout, unknown edge, membership gate, malformed frame, concurrency cap, push-wake-then-retry, refused-wake rejection, and nonce derivation. Added one boundary-collision regression test (38 total). Not exercised (no live libp2p/relay in-process, deferred to the first live-node ticket): relayed `/p2p-circuit` dial ordering, a genuinely half-open stall against a real libp2p stream, and large frames near `maxFrameBytes`.

**Empty categories:** No new major/backlog tickets were warranted — the one real defect was small enough to fix inline, and the two open questions were reviewer accept-decisions, not new work. No pre-existing test failures surfaced; nothing written to `.pre-existing-error.md`.
