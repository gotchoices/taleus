# TallyNet design

TallyNet is the lift protocol Taleus uses, and that other tally applications (e.g. a future MyCHIPs) can implement too: **route discovery** across the tally graph and **atomic commit** of a lift across many tally strands. It is a port of [ChipNet](https://github.com/gotchoices/ChipNet), assessed in [chipnet-review.md](chipnet-review.md), extended for tallies kept in different units of account (denominations).

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
- **Taleus assumes nothing about the lift protocol.** How many referees, who nominates them, how members identify themselves, how the record propagates and when it settles are TallyNet's to decide. `taleus-core` consumes what TallyNet produces (the record, its referee set and outcome) and its schema verifies that, rather than hard-coding a shape such as one referee per lift.
- Platform-neutral: no Node `crypto`, `Buffer` or timers left running. Use `@noble/hashes` and `globalThis.crypto.getRandomValues`, as `taleus-core` does. It must run in Node, React Native and the browser.

## Package conventions

Same as the rest of the monorepo (root `AGENTS.md`, `.editorconfig`): ESM (`"type": "module"`, `.js` import specifiers, no barrel cycles), TypeScript strict, tabs, single quotes, jest + ts-jest (root devDependencies), eslint via root `eslint.config.js`. Model `package.json`/`tsconfig.json`/`jest.config.*` on `packages/taleus-core`. Package name `tallynet`, unscoped like its siblings.

Amounts and other integers that can exceed 2^53 are `bigint` in memory and **decimal strings** on the wire. TallyNet itself only needs this where it compares or hashes terms, which it does canonically (below).

**Canonical encoding.** Everything signed is hashed over a canonical, typed, delimited encoding of the record, never `JSON.stringify` or ChipNet's `hashDeep` (see review, *Transaction module defects*). Pick one encoding and use it for every digest. Deterministic CBOR (`@ipld/dag-cbor`, from the same IPLD family as the `multiformats` package `taleus-model` already uses) is the default; JCS (RFC 8785) is acceptable. Record the choice in this file when made.

**Decided (scaffold):** deterministic **DAG-CBOR** (`@ipld/dag-cbor` v11, on `cborg`), sha256, in `src/digest.ts`. DAG-CBOR fixes one byte sequence per value — sorted map keys (so property order is irrelevant), shortest-form integers, no indefinite-length items, and it rejects `NaN`/`Infinity`/`undefined` outright. `src/digest.ts` also pre-validates and rejects functions, symbols, and objects with a non-plain prototype (`Date`, `Map`, class instances) with a path to the offending node. One accepted consequence: DAG-CBOR encodes an integer identically whether it arrives as a `number` or a `bigint`, so `digest(1) === digest(1n)`; this is harmless because amounts cross TallyNet as decimal **strings** (bigint only in memory). This digest is distinct from `taleus-core`'s settlement digest (the storage stack's framed tuple encoding, a different format for a different, fixed-shape input); the two share no preimage.

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

The **rename** `chipnet` → `tallynet` (protocol id `/taleus/chipnet/1.0.0` → `/tallynet/1.0.0`, `ChipNetTransport`, file names, docs, `docs/STATUS.md` item) happens in the binding step, not before, so that the app-side branch keeps building in the meantime.

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
- **Referee sets, as in ChipNet.** Any participant may nominate referees (`dependsOn`, referee-only members); the referee set is every referee member, and a majority settles. An empty referee set is invalid at validation time. Ties have a defined outcome (void) and do not satisfy both sides.
- A member may appear on more than one link (a circular lift starts and ends at the originator), so "find our member" returns all our links, not one.
- Terms are checked at promise time: each participant checks its own in/out links against its own policy (that's where Taleus's per-node quote check goes).

**Not in v1** (backlog): bidirectional search; ring/star propagation with a convergence node; pre-promise void on timeout; void-on-timeout and stalled-transaction recovery (coordinate with `feat-lift-timeout-release`); query economics and policing; advertising. v1 is unidirectional and push-to-reachable, and supports referee sets. Taleus's schema still holds one referee per edge; `feat-multi-referee-consensus` lifts that limit soon after binding, and until then Taleus's policy hooks refuse plans with more than one referee.

## Member identity and disclosure

The party authorised to act at a link of the route is whoever holds the private key registered there. TallyNet verifies signatures against that key and nothing else; it never asks who is behind it.

- **Neighbours bind the key.** A participant learns the key its neighbour uses for this lift over the tally connection they share, which the tally's own keys authenticate. That is the only place a lift key is tied to a real party. A participant may also tell its own referees who it is (`Member.secret`, encrypted to the referee).
- **Default (decided):** the whole route is visible to every member: member keys, any published dial addresses, every link's terms. Tally ids appear only as per-session nonces.
- **Settable, later** (`feat-tallynet-lift-identity-options`): a fresh key per lift instead of the party's stable agent key, and whether to publish a dial address (`Member.physical`). The two go together: a published libp2p address carries a stable peer id that defeats a per-lift key. A member with no dial address is reached through its link neighbours; each referee needs some path to every participant (its own published address, or relay through the member that nominated it).

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

`taleus-core` today accumulates the conversion at the **originator** in `negotiatePlan`, with each hop advertising its quote in its `L` terms (`src/lift/terms.ts`, `src/lift/discovery.ts` `accumulateRoute`). That discloses every intermediary's rate to the originator, at odds with architecture.md calling quotes private. Moving the conversion into item 2 fixes that, and `accumulateRoute`/`convertBoundary` are reused per hop. **Decided:** conversion happens at each converter on the return path (item 2); quotes are never advertised. The participants of a lift can still infer the effective rate it used from the committed amounts, which is accepted (`docs/architecture.md` § Exchange rate quotes).

**The query and per-node search policy (decided).** A search is currency-agnostic unless the caller says otherwise. The query carries the destination, the **landing unit** (denomination + divisor the payment must arrive in), optionally a **landing tally** the recipient names or prefers, the amount in the landing unit, and an optional *same currency only* flag. Each hop states its own edge's unit and capacity in its terms. The search is fully distributed: each node's **propagation policy** (a hook given the current unit, taken from its inbound edge, and the destination) decides whether to continue and through which candidates, or to drop the search. Depth and time budget are per-query parameters; defaults are the same for every query.

Open for the discovery / multi-denomination plans: how a hop beyond a currency boundary checks capacity on the outward pass, before the exact return-pass conversion exists. Either each converter forwards an estimated amount in the new unit (a small extension of the per-lift rate disclosure accepted in `docs/architecture.md` § Exchange rate quotes), or such hops do a coarse check and the real one happens on return.

## Testing approach

- **Unit**: nonce and session code; canonical digest (cross-check vectors with `taleus-core`'s `digest.ts` where they overlap); rule sets; budgeted step (fake timers; no leaked timers).
- **Simulated network**: an in-memory harness of N nodes wiring `queryPeer`/`updatePeer` directly, with injectable latency, drop and sleeping nodes. It should support a seeded random graph with assertions (ChipNet's 10k-node test asserted nothing). It ships as a platform-neutral subpath export, `tallynet/testing`, because the simulator builds on it.

## Simulation hooks

TallyNet is run at scale by `packages/tallysim` (thousands of nodes in one process, on simulated time) and watched through `packages/tallysim-viewer`. The engines serve that unchanged, with no test-only forks:

- **Clock port.** All time goes through an injected `Clock` (`now`, `setTimer`, `clearTimer`); the default is real time. Nothing else in `src/` reads `Date.now` or arms global timers.
- **Trace port.** An optional `TraceSink` receives typed `TraceEvent`s (query sent/received, candidate pruned with reason, plan returned/found, round budget expired, late answer folded in; record pushed, promise, vote, settle, release). Each event holds only what the emitting node already knows, so tracing adds no disclosure. A throwing sink is logged and ignored.
- **Determinism.** Under a seeded `RandomSource` and a virtual clock, a run is reproducible: no `Math.random`, and no behaviour that depends on unordered key iteration.
- **Adversarial consensus**: forged and replayed signatures, signature-type substitution, expired codes, duplicate members, a referee signing both commit and void, out-of-order and duplicated delivery, a node restarting mid-transaction.
- **Multi-denomination**: a route crossing two boundaries; a missing quote; an expired quote; rounding dust accrues to the originator only; the single-denomination case is unchanged.

## Working with the upstream source

The port reads ChipNet's source and docs; it does not depend on the package. Keep a checkout beside this repo:

```
git clone https://github.com/gotchoices/ChipNet ../chipnet    # from the taleus repo root; pin to 29fbc24
```

`doc/discovery.md` and `doc/cluster.md` there describe the designed-but-unbuilt features. Read them before planning any backlog item above.
