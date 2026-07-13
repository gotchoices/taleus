description: Review the new message-pipe layer that lets two people's devices exchange ChipNet's lift-discovery and commit messages over the network — the plumbing beneath the lift feature, built and tested but not yet connected to the real ChipNet library (which isn't installable yet).
files: src/transport/comms.ts, src/transport/chipnet-protocol.ts, src/transport/index.ts, src/transport/test-harness.ts, src/transport/comms.test.ts, src/transport/chipnet-protocol.test.ts, src/index.ts, tsconfig.build.json, docs/architecture.md (§ Transport, § Identity and address mapping, § Mobile and offline participation), tickets/blocked/chipnet-npm-publish-needed.md
----

## What this is

ChipNet is a meta-protocol: it never opens a socket, it calls host-supplied callbacks to move messages. This ticket implemented those callbacks over a libp2p protocol `/taleus/chipnet/1.0.0` between the two cadres of a tally — the **message pipe only**, per `docs/architecture.md` § *Transport*. Discovery search and commit logic are the *next two* tickets (`feat-lift-agent-discovery`, `feat-lift-referee-commit`); this ticket built the pipe they run over, plus the identity/address resolution beneath it.

Everything landed behind clean seams, `yarn build` / `yarn test` (37 tests, 4 suites) / `yarn lint` all green.

## What landed

- **`src/transport/comms.ts`** — dependency-free stream primitives: a minimal libp2p 3.x stream surface (`CommsStream`), a structural libp2p node port (`TransportNode`), and a 4-byte big-endian length-prefixed JSON frame codec with `writeFrame` / `readFrame` / `decodeLengthPrefixedFrame` / `withTimeout` / `readStreamToEnd`. Byte-compatible with Sereus's own control-network framing (mirrors `@serfab/cadre-core`'s internal `control-stream.ts`, which is not exported).
- **`src/transport/chipnet-protocol.ts`** — the `ChipNetTransport` class:
  - `queryPeer(request, linkId)` — resolve edge → dial → send one `QueryRequest` frame → await one `QueryResponse`. Bounded by a dial timeout; rejects promptly on a sleeping/unreachable edge so ChipNet's per-query time budget skips it.
  - `updatePeer(address, record)` — resolve member cadre → push a `TrxRecord`. On a failed commit dial it push-wakes the member (`pushWake` port) and retries once.
  - Inbound handler on `/taleus/chipnet/1.0.0`: reads a frame, membership-gates it, dispatches up to a registered `QueryResponder` / `RecordParticipant`. Reentrant, capped at `maxConcurrent`.
  - `nonceToLinkMap` (private): the salted per-session nonce ↔ real `linkId` map. `computeNonce(sessionCode, linkId) = base64(sha256(sessionCode ‖ linkId))`. Only nonces cross the wire.
  - The **registration seam**: `registerResponder` / `registerParticipant` (downstream tickets bind these), and `registerEdge` / `forgetEdge` (the agent maps its own edges into a session).
- **`src/transport/test-harness.ts`** — in-memory `Chan` / duplex `CommsStream` pair / `InMemoryNode` (routes `dialProtocol` to a peer's handler). Excluded from the production build (`tsconfig.build.json`), so it never ships in `dist/`.
- Re-exported from `src/index.ts`.

## How to exercise it (validation use cases)

The two test files are the floor — **treat them as a starting point, not proof of correctness.** They run two `ChipNetTransport`s over an in-memory node pair (no libp2p, no real cadre). Covered:

- **Discovery round-trip** — `A.queryPeer` → `B`'s responder → response back; responder receives the resolved real `linkId`, not a nonce.
- **Commit push** — `A.updatePeer` → `B`'s participant receives the `TrxRecord` and the sending peer id.
- **Sleeping/unreachable edge is skipped, not fatal** — a query to a dead edge rejects; a sibling query to a live edge still succeeds.
- **Dial timeout** — a never-responding edge rejects within the dial-timeout budget (stream aborted, not left hanging).
- **Unknown edge** — an inbound query naming a nonce the receiver cannot map returns a non-error `unknown edge` response and never invokes the responder (privacy: an unmappable nonce is not an error to leak).
- **Membership gate** — an inbound query whose sender is not the edge's counterparty is rejected; responder not invoked.
- **Malformed frame** — an unexpected frame kind / oversized / truncated frame is rejected, receiver does not crash.
- **Concurrency cap** — with `maxConcurrent: 1`, the overflow inbound stream is rejected while the first is in flight.
- **Push-wake on commit** — a failed commit dial triggers `pushWake` then a re-resolve + retry; a *refused* wake makes `updatePeer` reject (not hang), so the referee ticket can degrade to timeout-void.
- **Nonce derivation** — deterministic, session-salted, never contains the raw `linkId`, base64-shaped.

**Suggested reviewer probes beyond the floor:** relayed/`/p2p-circuit` dial ordering (the harness ignores address order — real `resolvePeerAddrs` returns signaling-first, and `runOnLimitedConnection: true` is set but unverified against a real relay); a genuinely half-open stream that stalls mid-frame against a real libp2p stream; back-to-back concurrent sessions sharing one edge (correlation by `sessionCode`); very large frames near `maxFrameBytes`.

## Known gaps / deliberate deviations (read before reviewing)

1. **ChipNet is not bound — it isn't installable.** `chipnet` / `chipcryptbase` are unpublished (HTTP 404 on npm; no `dist/` on GitHub install) — the standing blocker `tickets/blocked/chipnet-npm-publish-needed.md`, confirmed still 404 this run. Consequences, all flagged with `NOTE:` at their code sites:
   - The ChipNet message types (`Address`, `QueryRequest`, `QueryResponse`, `TrxRecord`) are a **local port** capturing only the fields the transport reads for routing/correlation (`sessionCode`, `transactionCode`). Every message's substance rides in an **opaque `body`** the transport frames verbatim and never interprets — faithful to ChipNet's opaque-`Record<string,unknown>` model. When the packages land, replace the port with `chipnet` imports; the wire envelope stays unchanged.
   - `computeNonce`'s exact `sessionCode ‖ linkId` byte layout must be reconciled with ChipNet's own `AnonymityService` when it lands (both Taleus sides already agree, since they run the same function). A separator is used to keep the concat unambiguous.
2. **`@serfab/cadre-core` was NOT added as a dependency** — the ticket asked to bind it here. Reasons: (a) with ChipNet unbindable, nothing here can be exercised end-to-end against a real node regardless; (b) cadre-core drags the full `optimystic` + `libp2p` + `quereus` tree, which risks native (gyp) build failures on Windows and would jeopardize the currently-green, cross-platform `yarn install`/`build`. Instead the exact `CadreNode` surface the transport needs is a typed port (`ChipNetTransportHost`: `node` (`handle`/`dialProtocol`), `resolveEdge`, `resolveAddress`, `isCounterparty`, `pushWake`) — a one-to-one match with real `CadreNode` methods (`resolvePeerAddrs`, `pushWake`, `handle`/`dialProtocol`). This mirrors cadre-core's own DI pattern (its `StrandWakeService` injects `isMember`/`getStrand`/`wake` "so the service is testable without a full node"). Binding a real `CadreNode` to these ports is a thin adapter that belongs in whichever ticket first stands up a live node (`feat-lift-agent-discovery` / app-wiring). **Reviewer: confirm this is an acceptable deviation, or convert to a hard cadre-core dep if the native-build risk is judged acceptable.**
3. **Record membership-gating is nonce-conditional.** Inbound `query-request` frames are hard membership-gated (sender must be the edge counterparty). Inbound `trx-record` frames are gated **only when their nonce maps to a known edge** — a record fanning out over a `C`-intent relay hop may name a nonce the receiver doesn't map, and is dispatched for the participant to correlate by `sessionCode`/`transactionCode`. This is deliberate (records are transaction-scoped, may legitimately arrive via referee/relay, not the direct edge counterparty), and the real safety boundary is the schema's referee-signature verification in `feat-lift-referee-commit`, not this transport gate. **Reviewer: confirm the participant contract (never trust a record without verifying the referee signature) is carried into `feat-lift-referee-commit`.** Documented inline at `dispatchRecord`.

## Tripwires (parked, not tickets)

- **Nonce map growth** — `NOTE`-worthy: `nonceToLinkMap` grows one entry per (session, edge) until `forgetEdge` is called. The agent (discovery/commit tickets) owns lifecycle cleanup after a lift resolves; if that cleanup is ever missed, the map leaks. Recorded here; the map is small per lift, so not a concern until many long-lived sessions accumulate. Parked as a review-findings line, not filed — it becomes real only if the downstream agent forgets to call `forgetEdge`.
- **Cross-cadre commit-wake semantics** — `pushWake(peerId, strandId, reason)` is the port; whether Sereus's control-network `CadreNode.pushWake` (which wakes *same-cadre* peers) can reach a *counterparty's* phone-only participant, or whether that needs a tally-strand-level push fan-out, is a Sereus-layer question to settle when the node is stood up. Parked here; the transport is agnostic to it (it just calls the port).

## Review findings (index — detail lives at each site above)

- ChipNet binding deferred on an external blocker (`chipnet-npm-publish-needed`); message types are a local opaque-body port with `NOTE:` markers — §Known gaps 1.
- `@serfab/cadre-core` modeled as a typed port rather than a hard dependency (Windows native-build risk + no e2e path while ChipNet is unbindable) — §Known gaps 2. Needs a reviewer accept/convert decision.
- `trx-record` membership gating is nonce-conditional by design; safety rests on the referee-signature check downstream — §Known gaps 3. Needs the participant-contract carry-through confirmed.
- Two tripwires parked (nonce-map growth cleanup; cross-cadre wake reach) — §Tripwires. Neither filed as a ticket.
- No pre-existing test failures surfaced; nothing written to `.pre-existing-error.md`.
