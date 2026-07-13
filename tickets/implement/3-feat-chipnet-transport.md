----
description: Wire ChipNet's "send a message to my tally partner" hooks to a real network channel between the two parties' devices, so lift discovery and commit messages actually travel between cadres.
prereq: feat-taleus-lib-scaffolding
files: src/transport/chipnet-protocol.ts (new), src/transport/comms.ts (new), docs/architecture.md (§ Transport: /taleus/chipnet/1.0.0, § Identity and address mapping, § Mobile and offline participation)
difficulty: medium
----

ChipNet is a meta-protocol: it never opens a socket. It calls host-supplied callbacks to move messages. This ticket implements those callbacks over a libp2p protocol `/taleus/chipnet/1.0.0` between the two cadres of a tally, per `docs/architecture.md` § *Transport*. It does **not** implement discovery or commit logic (that is `feat-lift-agent-discovery` / `feat-lift-referee-commit`) — only the message pipe and the identity/address resolution beneath it.

## What to build

Two callbacks, one protocol handler:

- **`QueryPeerFunc(request: QueryRequest, linkId: string) => Promise<QueryResponse>`** — discovery request/response. Resolve `linkId` (a tally) to the counterparty cadre's dialable address via Sereus `resolvePeerAddrs`, dial `/taleus/chipnet/1.0.0`, send one `QueryRequest` frame, await one `QueryResponse` frame.
- **`updatePeer(address: Address, record: TrxRecord) => Promise<void>`** — commit/consensus push. Address a member by its cadre (`Address` → cadre address, or `topology.members[].physical` when present) and push a `TrxRecord`.
- **Inbound handler** on `/taleus/chipnet/1.0.0` that dispatches received `QueryRequest`/`TrxRecord` frames up to the agent's registered responder/participant (registered by the downstream tickets; this ticket defines the registration seam and framing).

Bind `@serfab/cadre-core` here (address resolution, dialing, protocol registration) — the first ticket that needs the runtime. Reference the Sereus protocol conventions (`/sereus/seed/1.0.0`, `/sereus/strand-wake/1.0.0`, `resolvePeerAddrs`, `DeviceToken`) in `../sereus/docs/architecture.md`.

## Identity/address resolution

- Hold the private `nonceToLinkMap` (ChipNet nonce → real `linkId`) — only the owning agent maps a salted-hash nonce back to a real tally; never expose it on the wire.
- `linkId` ↔ tally strand id ↔ counterparty cadre: a tally's cohort is both parties' cadres, so the counterparty's always-on node is the dial target. Resolve via the tally's membership, not a global directory.

## Mobile/offline

- A hibernating counterparty's `QueryPeerFunc` dial will not complete; return promptly so ChipNet's per-query **time budget** skips it and folds any late response into the next phase (do not block the whole round). Do **not** invent a retry storm.
- For the **commit window**, integrate Sereus push-wake (`/sereus/strand-wake/1.0.0` + `DeviceToken` push) so a phone-only participant can be brought up to receive/forward the commit `TrxRecord`. Discovery does not push-wake (opportunistic-while-awake only).

## Edge cases & interactions

- **Timeout vs. abort.** A dial that never completes must be bounded (mirror Sereus's `seedReadTimeoutMs` posture); a stream that half-opens and stalls must abort, not hang — otherwise one dead edge stalls a whole discovery round.
- **Concurrent lifts / reentrancy.** Multiple discovery sessions and multiple in-flight lifts share the protocol; frames must be correlated by ChipNet's `sessionCode`/`transactionCode`, and the inbound handler must be reentrant (bound concurrent inbound streams, as `/sereus/seed` caps `maxConcurrentSeeds`).
- **NAT / relay.** Phone↔phone tallies are relay-only until WebRTC upgrade; `resolvePeerAddrs` returns signaling (`/p2p-circuit`) addresses — the transport must accept relayed dials, not assume direct.
- **Privacy.** Never place a raw `linkId` or tally id in a frame that leaves the owning agent; only `nonce`s cross the wire. A received frame naming a nonce the agent cannot map is not an error to leak — handle as unknown-edge.
- **Frame validation.** Reject malformed/oversized frames; verify the sending peer is the tally's counterparty (membership-gated) before dispatching upward. Do not trust `Address` from the frame alone.
- **Wake failure.** Push-wake can fail (token stale, phone off); commit must degrade to timeout-void via the referee, not hang — coordinate this contract with `feat-lift-referee-commit`.

## TODO

- Implement `/taleus/chipnet/1.0.0` registration + framing (request/response for discovery, push for records) on the cadre node.
- Implement `QueryPeerFunc` and `updatePeer` with `resolvePeerAddrs`-based resolution and the private `nonceToLinkMap`.
- Implement the inbound dispatch seam the agent/referee tickets register against.
- Integrate push-wake for the commit window; bound all reads/dials with timeouts; cap concurrent inbound streams.
- Tests: round-trip a `QueryRequest`/`QueryResponse` and an `updatePeer` push between two in-process cadre nodes; a timed-out peer is skipped, not fatal. Stream test output with `tee`.
