# TallyNet design

TallyNet is Taleus's lift protocol library: **route discovery** across the tally graph and **atomic commit** of a lift across many tally strands. It is a port of [ChipNet](https://github.com/gotchoices/ChipNet), assessed in [chipnet-review.md](chipnet-review.md), extended for tallies kept in different units of account (denominations).

Read first: [`docs/architecture.md`](../../../docs/architecture.md) § *Denominations and Exchange* and § *Lifts and ChipNet*, and [`docs/denominations.md`](../../../docs/denominations.md). Those sections are the system-level design this package serves. Where they say "ChipNet", read "TallyNet".

## Scope and boundaries

Three layers. Each depends only on the one above it.

| Layer | Package | Knows about |
|---|---|---|
| **Protocol** | `packages/tallynet` (this package) | Members, links, nonces, plans, records, signatures, time budgets. Generic over link terms and payload. **No** tallies, denominations, Quereus, libp2p or Sereus. |
| **Taleus lift policy** | `packages/taleus-core/src/lift/`, `src/transport/` | What an `L` term means (denomination, divisor, capacity, fee, quote), conversion math (`convertBoundary`), route selection, the per-edge referee digest the schema verifies, the `/taleus/…` wire protocol framing. Implements TallyNet's callbacks. |
| **Live wiring** | `packages/taleus-sereus`, `packages/taleus-node` | Binding the transport to a running cadre node, Quereus-backed state, push-wake, the always-on service. |

Rules that keep it that way:
- `tallynet` does **not** import `taleus-core`. It declares the small ports it needs (hash, sign, verify, random, clock); `taleus-core`'s `CryptoProvider` satisfies them.
- Terms and payload are type parameters (`<TTerms>`, `<TPayload>`), not `unknown`. TallyNet never inspects them; it hands them to callbacks.
- Platform-neutral: no Node `crypto`, `Buffer` or timers left running. Use `@noble/hashes` and `globalThis.crypto.getRandomValues`, as `taleus-core` does. It must run in Node, React Native and the browser.

## Package conventions

Same as the rest of the monorepo (root `AGENTS.md`, `.editorconfig`): ESM (`"type": "module"`, `.js` import specifiers, no barrel cycles), TypeScript strict, tabs, single quotes, jest + ts-jest (root devDependencies), eslint via root `eslint.config.js`. Model `package.json`/`tsconfig.json`/`jest.config.*` on `packages/taleus-core`. Package name `tallynet`, unscoped like its siblings.

Amounts and other integers that can exceed 2^53 are `bigint` in memory and **decimal strings** on the wire. TallyNet itself only needs this where it compares or hashes terms, which it does canonically (below).

**Canonical encoding.** Everything signed is hashed over a canonical, typed, delimited encoding of the record, never `JSON.stringify` or ChipNet's `hashDeep` (see review, *Transaction module defects*). Pick one encoding and use it for every digest. Deterministic CBOR (`@ipld/dag-cbor`, from the same IPLD family as the `multiformats` package `taleus-model` already uses) is the default; JCS (RFC 8785) is acceptable. Record the choice in this file when made.

## The seam taleus-core already defines

`taleus-core` was built against ChipNet's callback shapes, with the ChipNet parts as injected **ports** tested against in-memory doubles, because ChipNet could not be installed. TallyNet's job is to supply real implementations of those ports. Today's state:

| taleus-core port | File | TallyNet provides |
|---|---|---|
| `DiscoveryEngine.discover(query, callbacks) → CandidateRoute[]` | `src/lift/agent.ts:131` | A unidirectional originator + participant driving `NegotiateCallbacks`. Partial rounds return a (possibly empty) list, never a throw. |
| `NegotiateCallbacks { negotiateIntent, negotiatePlan }` | `src/lift/discovery.ts:316` | The hook points discovery calls. Taleus's implementations already exist (`makeNegotiateCallbacks`). Their signatures will change with the hop-context work (below). |
| `ConsensusEngine.resolve(record) → record` | `src/lift/commit.ts:341` | The promise/commit state machine driving a `LiftRecord` to commit or void. |
| `EdgeStrand`, `EdgeSigner`, `LiftParticipant` | `src/lift/commit.ts` | Stay Taleus-side; they back TallyNet's resource and state ports (`promise`, `release`, record store). |
| `QueryRequest`/`QueryResponse`/`TrxRecord`/`Address` (local port) | `src/transport/chipnet-protocol.ts:61-86` | Replace with TallyNet's exported types; keep the transport's wire envelope (an opaque framed `body`). |
| `QueryPeerFunc`, `UpdatePeerFunc` | `src/transport/chipnet-protocol.ts:83-86` | Same callback roles. `ChipNetTransport` already implements them over libp2p ports. |
| `computeNonce(sessionCode, linkId)` | `src/transport/chipnet-protocol.ts:222` | TallyNet's nonce function. Keep one implementation, in TallyNet, and have the transport import it. |
| `SingleReferee` + `getCommitDigest` injection | `src/lift/referee.ts:83` | TallyNet exports its record-digest function so the referee signs exactly what TallyNet verifies. |

`taleus-core` lift/transport tests (`yarn test src/lift src/transport` in that package, 104 passing at handoff) are the regression floor for the binding step.

The **rename** `chipnet` → `tallynet` (protocol id `/taleus/chipnet/1.0.0` → `/taleus/tallynet/1.0.0`, `ChipNetTransport`, file names, docs, `docs/STATUS.md` item) happens in the binding step, not before, so that the app-side branch keeps building in the meantime.

## Protocol design (carried from ChipNet, with corrections)

**Discovery** keeps ChipNet's shape: the originator drives rounds; each round goes one level deeper; each participant keeps per-session sub-query state between rounds and answers with plans found so far and a reentrance ticket. Edges travel only as per-session nonces. The path is built outward; members are added on the way back. Changes from ChipNet:

- **Split durable from in-flight state.** The persisted query context holds only serialisable data (query, plan so far, candidates with their nonce, depth and last response). In-flight requests live in an in-memory table keyed by session and candidate. A restart loses in-flight requests, which is acceptable: those candidates are simply retried or dropped next round.
- Fix the no-op filters: cycle removal, pruning of failed candidates, duplicate-query rejection.
- Use the real time budget, and validate peers' timing statistics before trusting them. Always clear timers.
- **Hop context** for negotiation (the main extension; see next section).
- Extensible intent codes (`string`), not `'L' | 'C'`.

**Consensus** keeps ChipNet's model: a self-describing record (payload, topology, promise signatures, commit signatures), merged by union, pushed to reachable members until settled. Participants promise; referees vote; a majority settles. Changes from ChipNet:

- Every signature covers the canonical digest **and its own signature type**, and verification recomputes exactly that preimage. Every verification is awaited.
- Decide before holding: `shouldPromise` runs before `promise` holds anything.
- Expired transaction or session codes always refuse. Missing policy hooks never mean "approve".
- An empty referee set is invalid at validation time. Ties have a defined outcome (void) and do not satisfy both sides.
- A member may appear on more than one link (a circular lift starts and ends at the originator), so "find our member" returns all our links, not one.
- Terms are checked at promise time: each participant checks its own in/out links against its own policy (that's where Taleus's per-node quote check goes).

**Not in v1** (backlog): bidirectional search; ring/star propagation with a convergence node; pre-promise void on timeout; void-on-timeout and stalled-transaction recovery (coordinate with `feat-lift-timeout-release`); multi-referee (`feat-multi-referee-consensus`); query economics and policing; advertising. v1 is single-referee, unidirectional, push-to-reachable. That matches what `taleus-core` and the schema implement today.

## Multiple denominations

The system design is already settled in `docs/architecture.md`:
- A payment is stated in the payee's denomination.
- Each intermediary that bridges two denominations uses its own private, directional `ExchangeRateQuote`.
- The required amount is converted backward from the payee, `req_in = ceil(req_out · RateNum · d_in / (RateDen · d_out))`, BigInt, one ceiling per boundary; the originator absorbs the dust.
- A missing or expired quote prunes the route.
- Each edge's integer units are fixed at commit in that edge's own denomination.

What TallyNet must add to make that work:

1. **Negotiation sees the hop, not just the query.** ChipNet calls `negotiateIntent(linkIntent, queryIntents)` with the originator's terms at every hop. TallyNet passes a hop context: the inbound link's terms (the last `PlanLink` of the path so far), the candidate outbound link's terms and the query. It returns the outbound link's terms as constrained. Single-denomination behaviour is the special case where the context is ignored.
2. **Return-path annotation.** When a plan travels back toward the originator, each participant may amend its own in-edge (the link it was reached by) before prepending itself. This is where a bridging node computes `req_in` from `req_out` with its private quote, so the quote never leaves the node; only the resulting integer amounts are disclosed. ChipNet's `prependMatch` is the natural place. Expose it as a callback (`annotateReturn(plan, self, inLinkNonce) → plan | undefined`; `undefined` drops the plan).
3. **Satisfaction is pluggable, not uniform.** Replace `intentsSatisfied` (same query terms against every link) with a host predicate over the whole plan.
4. **Promise-time check per node.** `shouldPromise` receives our in/out links with their terms; Taleus checks the amounts against its current quote and trading variables there. Each user decides whether to bridge denominations, through whether they keep a quote at all (no quote means no conversion; see the decision ticket).

`taleus-core` today accumulates the conversion at the **originator** in `negotiatePlan`, with each hop advertising its quote in its `L` terms (`src/lift/terms.ts`, `src/lift/discovery.ts` `accumulateRoute`). That discloses every intermediary's rate to the originator, at odds with architecture.md calling quotes private. Moving the conversion into item 2 fixes that, and `accumulateRoute`/`convertBoundary` are reused per hop. Which model to use is an open decision: `tickets/blocked/tallynet-denomination-policy.md`.

Routes that change denomination will be rarer, since they need a bridging node with a quote at each boundary. Whether discovery should search them more widely (larger depth or budget) is part of the same decision ticket.

## Testing approach

- **Unit**: nonce and session code; canonical digest (cross-check vectors with `taleus-core`'s `digest.ts` where they overlap); rule sets; budgeted step (fake timers; no leaked timers).
- **Simulated network**: an in-memory harness of N nodes wiring `queryPeer`/`updatePeer` directly, with injectable latency, drop and sleeping nodes. It should support a seeded random graph with assertions (ChipNet's 10k-node test asserted nothing).
- **Adversarial consensus**: forged and replayed signatures, signature-type substitution, expired codes, duplicate members, a referee signing both commit and void, out-of-order and duplicated delivery, a node restarting mid-transaction.
- **Multi-denomination**: a route crossing two boundaries; a missing quote; an expired quote; rounding dust accrues to the originator only; the single-denomination case is unchanged.

## Working with the upstream source

The port reads ChipNet's source and docs; it does not depend on the package. Keep a checkout beside this repo:

```
git clone https://github.com/gotchoices/ChipNet ../chipnet    # from the taleus repo root; pin to 29fbc24
```

`doc/discovery.md` and `doc/cluster.md` there describe the designed-but-unbuilt features. Read them before planning any backlog item above.
