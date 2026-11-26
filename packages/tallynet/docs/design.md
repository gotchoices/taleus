# TallyNet design

TallyNet is the lift protocol Taleus uses, and that other tally applications (e.g. a future MyCHIPs) can implement too: **route discovery** across the tally graph and **atomic commit** of a lift across many tally strands. It is a port of [ChipNet](https://github.com/gotchoices/ChipNet), assessed in [chipnet-review.md](chipnet-review.md), extended for tallies kept in different units of account (denominations).

Status and the order of remaining work: [STATUS.md](STATUS.md).

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
- **Taleus assumes nothing about the lift protocol.** How many voters, who nominates them, how members identify themselves, how the record propagates and when it settles are TallyNet's to decide. `taleus-core` consumes what TallyNet produces (the record, its voter set and outcome) and its schema verifies that, rather than hard-coding a shape such as one voter per lift.
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
- Use the real time budget, computed solely from the originator's own options; **nothing trusts peer-reported timing** (see *Time budget* below). Always clear timers.
- **Hop context** for negotiation (the main extension; see next section).
- Extensible intent codes (`string`), not `'L' | 'C'`.

**Reach: `maxDepth` counts hops, and the bound is tight.** An **L-hop** route is found at exactly `maxDepth = L` — one round per level — and missed at `maxDepth = L − 1`. `maxDepth` counts hops the same way the simulator's routing oracle does. A target reached as a *peer-match terminus* (a neighbour resolves it from its own adjacency rather than the search entering it as a relay) still costs no extra round: the peer-match resolves the final hop in the same round, so an L-hop plan satisfies `path.length = L ≤ maxDepth = L`. (An earlier draft claimed reach was `⌊maxDepth/2⌋ + 1` — "half the ceiling", `maxDepth ≥ 2(L − 1)`. That was not a protocol property but a measurement artifact of the test/sim `VirtualClock` under-draining discovery's per-level completion cascade; it is withdrawn.) The `VirtualClock` now drains a full **macrotask** between fires, which flushes a continuation cascade of any length in one hop, so this reach no longer depends on a tuned drain threshold — see the drain docs atop `src/testing/clock.ts`.

### Time budget (decided: drop the histogram)

Each round waits a bounded time for replies before stepping one level deeper. The budget is **linear in the round**: `initialBudgetMs + round * perHopBudgetMs` (defaults 2000 ms + 1500 ms/round in `OriginatorOptions`). A deeper round gets a larger budget because its round-trip is longer. The constants are coarse — there is **no adaptive tuning in v1**.

Two deliberate departures from ChipNet:

- **The `sparstogram` dependency is dropped** — not for platform-compatibility (it is pure-ESM and React-Native-safe) but because adaptive histogram budgeting was an untested prototype optimisation, and dropping it removes the "trust a peer's reported stats" attack surface entirely. ChipNet grew the per-round budget from peers' reported timing histograms behind a `validatedStats` stub that trusted them outright (`chipnet-review.md`, `originator.ts:62`).
- **The budget never reads peer-reported stats.** Peer `QueryStats` (`earliest` / `latest` / `gross` / `outstanding`) stay in the protocol as **informational only** — a simulator or viewer can display a round's shape, but nothing in control flow trusts them, so there is nothing to validate. A node sizes its budget purely from its own `OriginatorOptions` and its own clock.

The adaptive version — size the budget from a distribution of round-trip times the originator **measures itself** (never a peer's figure), e.g. a locally-tracked quantile — is parked as backlog `feat-tallynet-adaptive-budget`. It depends on nothing but is a pure optimisation, best judged against simulator metrics.

*Implemented in `src/discovery/`: the one-link-shape data model (`types.ts`), the durable/in-flight state split (`store.ts` holds only serialisable data; the participant holds the live requests), the negotiation hooks with hop context (`hooks.ts`), `enter`/`reenter` with the no-op filters fixed and the real budget honoured (`participant.ts`), the originator round loop + linear budget (`originator.ts`), and the per-node `DiscoveryNode` bundle that wires both roles (`engine.ts`). End-to-end discovery is proven over the in-memory harness (`src/testing/`, driven in `src/testing/discovery.test.ts`). The `taleus-core` adapter is described in `engine.ts` and implemented by `feat-tallynet-bind-taleus-core`.*

**Consensus** keeps ChipNet's model: a self-describing record (payload, topology, promise signatures, commit signatures), merged by union, pushed to reachable members until settled. Participants promise; voters vote; a majority (or the proposal's threshold) settles. Changes from ChipNet:

- Every signature covers the canonical digest **and its own signature type**, and verification recomputes exactly that preimage. Every verification is awaited.
- **No unverified input may change state that blocks a verified one.** A commit-phase signature binds the *complete* promise set, so it cannot be verified until every participant has promised. Until then it is held in a durable **side pool** (keyed by `transactionCode`, capped per voter, never digested, never pushed, never part of the wire record) and is promoted into the counted `commits` set only after it verifies against the complete promise set. This closes the *forged-commit-shadows-vote* hole: previously an out-of-order commit sat in the authoritative `commits` set unverified while the promise phase was still open, so a forwarding node could inject a garbage commit for a voter before the promises completed — it occupied that voter's slot, and the voter's genuine vote then collided with it (`changed`/`equivocation`) and was silenced. This is a **liveness/outcome** concern, not a safety one (a forged vote never *counts* — it never verifies), but a suppressed genuine vote could stall or wrongly void a lift that should have committed. Promise-phase signatures need **no** pool: a promise's preimage never depends on the promise set, so each is verified the instant it arrives and an unverified promise is never stored — a forged promise can never become the `existing` entry that shadows a genuine one. (Implemented as `getPendingCommits`/`savePendingCommits` on the store, with the merge→drain→promote path in `participant.ts`.)
- Decide before holding: `shouldPromise` runs before `promise` holds anything.
- Expired transaction or session codes always refuse. Missing policy hooks never mean "approve".
- **Voter sets.** Any participant may nominate voters (`dependsOn`, voter-only members — a voter-only member is a referee); the voter set is every `V` member. Settlement reads the proposal's consensus method (see § Lift proposal and settlement below): a side settles when it holds a **strict majority of total vote weight and reaches the method's threshold**, counted both ways over distinct voters. The strict-majority floor keeps commit and void mutually exclusive — the two counts sum to at most `W` (the voter count), so both can never clear it, and an even split satisfies **neither** (this fixes ChipNet's bug where an even split satisfied both and reject won by being tested first, `chipnet-review.md` § Transaction module defects `:285-287`). The default `1/2` threshold is a plain strict majority, byte-identical to ChipNet. An empty voter set is invalid at validation time (there is no "majority of zero" — ChipNet's `isConsensus(0,0)=true`). A **tie or an unreached threshold** (a set of 2 that splits 1 commit / 1 void, or the no-settle band a threshold above `1/2` opens) is therefore **no consensus yet**: it does not settle in either direction. The *eventual* resolution of a stuck case to void is a **timeout** (void-on-timeout), out of scope for v1 (`tallynet-propagation-timeouts`); v1 has **no timer**, so it simply does not settle in-band. The record's deadline is already carried by the self-expiring transaction code (`expiresAt(transactionCode)`), so the timeout feature needs no new field — it injects a voter `NC` at the `propagating` branch of the participant's `advanceState`.
- A member may appear on more than one link (a circular lift starts and ends at the originator), so "find our member" returns all our links, not one.
- Terms are checked at promise time: each participant checks its own in/out links against its own policy (that's where Taleus's per-node quote check goes).

### Lift design principles

Carried from the original MyCHIPs lift and ChipNet designs. Where TallyNet doesn't yet meet one, [STATUS.md](STATUS.md) names the ticket that builds it.

0. **No global rules; each node decides.** Every rule a lift runs under is a parameter in the lift proposal (voter set, consensus method and threshold, deadline, participants’ terms, an optional lift contract reference). Each node propagates or refuses by its own policy; the originator chooses among returned plans. Protocol code enforces only verified signatures, a consensus method under which commit and void can never both be reached, and the deadline. The default method is one vote per distinct voter, strict majority; alternatives (weight split per nominator, higher thresholds) stay open until hostile-actor simulation compares them.
1. **Voters, not a referee.** A **participant** is an entity whose tallies the lift moves; a **voter** is anyone proposed to vote; a **referee** is a voter that is not a participant. Participants may vote themselves and/or nominate referees (`dependsOn`); the voter set is their union and its majority settles the lift. The code names voters by member type `V` (a referee is simply a `V` member that is not also `P`).
2. **Validating evidence can come from anywhere, and merging is idempotent.** Whichever node first holds a deciding majority propagates it; nothing routes through the originator. Duplicates and smaller records only add to what a node knows. A voter signing both commit and void is equivocation: refused, and its proof kept.
3. **Promised means resolvable.** Once every participant has promised, the lift resolves to commit or void by the voters' majority alone, never by one participant, and every cooperating member can obtain the outcome even if some member refuses to sign or relay. A refuser only hurts itself: its neighbour's edge finalises from the refuser's phase-1 promise plus the commit evidence.
4. **The originator runs the lift; linear and circular lifts share one protocol.** Discovery (unsigned) may return several plans; the originator proceeds by choosing one, signing its promise and propagating the record, and can abort only before every participant has promised. A linear lift is a circular one minus the final chit back to the originator; the payee's word reaches the originator through a contact point carried in the proposal or back along the route. Members that publish contact points can be updated by strangers; others hear from their direct neighbours.

### Lift proposal and settlement (the voter model)

The decisions `tallynet-voter-model` settled (with the developer, 2026-11-25) that turn the principles above into a buildable shape. Each names the implement ticket that builds it; until all land, the terms and the per-edge attachment below describe the current, not the intended, state.

**Terms.** A **participant** is a member whose tallies the lift moves; a **voter** is any member proposed to vote; a **referee** is a voter that is not a participant. The code's member-type codes are `P` (participant) and `V` (voter) — the former `R` (and the "referee" naming) was renamed to voter throughout `tallynet`, `tallysim` and the viewer (`tallynet-terms-and-proposal-params`). A member may be both `P` and `V` (a participant that votes itself). The voter set is every `V` member; its majority (or the proposal's higher threshold) settles the lift.

**Proposal parameters** (`tallynet-terms-and-proposal-params`). Every rule a lift runs under is a parameter each node accepts or refuses for itself; the protocol enforces only what keeps settlement consistent. They ride the immutable, promise-signed record core (and, so a node can refuse early, the discovery `UniQuery`):

- **Consensus method** — `{ weighting: 'distinct-voter', thresholdNum, thresholdDen }`. v1 implements one `weighting`, `distinct-voter` (one vote per distinct voter; total weight = voter count); `nominator-split` and other weightings are reserved enum values validation rejects until built, and stay open until `tallysim-hostile-actors` compares them under attack. A side settles when it holds a **strict majority** of total vote weight **and reaches** the threshold fraction (`weight > W/2` and `weight ≥ (thresholdNum/thresholdDen)·W`). **Default `1/2`**: plain strict majority, exactly today's behaviour. The strict-majority floor keeps commit and void mutually exclusive for any threshold; the threshold only raises the bar, so `2/3` on 3 voters settles with 2, and `1` means unanimity. Valid range `1/2 ≤ t ≤ 1`. A threshold above `1/2` opens a no-settle band between the two that only a timeout resolves (`tallynet-propagation-timeouts`); v1 has no timer, so such a lift simply does not settle in-band.
- **Deadline** — carried today by the self-expiring `transactionCode` (`expiresAt`). Made an explicit proposal field by `tallynet-propagation-timeouts`; leave the seam.
- **Lift contract CID** — an optional `liftContract` (a Stroc CID), the human-readable rules this lift runs under. **Machine parameters** (voter set, consensus method, threshold, deadline) are enforced by protocol code; the **contract prose** (what counts as commit/void beyond the vote faces, tie handling, deadline semantics, equivocation remedies) is read by each node's host policy, which refuses a CID it does not recognise or accept. Whether a *tally* contract limits which *lift* contracts its tally honours, and whether Taleus publishes one or more default lift-contract documents in `contracts/`, are host/schema questions owned by `feat-tallynet-bind-taleus-core` (yes to a default document; TallyNet carries only the CID). This package never fetches or parses a contract.

**One plan per record (v1).** The originator mints a record from a **single** discovery plan. Aggregating several plans to meet one amount (a multi-path lift) is deferred to backlog `feat-tallynet-multi-path-lift`: it would split the amount across disjoint routes and settle them atomically together — a large extension. If no single plan meets the amount the originator keeps searching or the lift fails. Tradeoff: one topology, one majority, simple atomicity; no capacity aggregation across parallel routes.

**Proceed / abort, and plan→topology minting** (`tallynet-originator-proceed`). The missing library step the regression check flagged: the originator folds a returned `Plan` into a `TrxRecord.topology` — unioning each participant's self-vote with its `dependsOn` nominees into the `V`-member set the majority is counted over, keying the path links by nonce, and stamping the proposal parameters — then signs its own promise and propagates. **Proceed** is choosing a plan and starting phase 1; **abort** (only before every participant has promised) is signing a pre-promise void. After every participant has promised the originator has no special power (principle 3). This is also where the originator and voters stamp their contact points.

**Contact points** (`Member.physical`, a dial multiaddr; `tallynet-record-availability`). A member that publishes one can be reached by any node holding the record (a "stranger"); one that does not hears only from its direct link neighbours. **For the single-non-cooperating-member guarantee (principle 3) to hold on a *linear* lift, the originator and every voter must publish a contact point** — otherwise an interior member that refuses to relay blocks the commit evidence from the members beyond it, because nothing routes around it. A *circular* lift's ring already routes around one refuser without contact points. At **k > 1** non-cooperating members the guarantee holds only while the cooperating members plus the published contact points keep a voter-majority assembled and every cooperating member reachable from it; a cut that isolates a cooperating member from every voter's contact point *and* from an alternate path leaves it pending until connectivity returns (any single cross-island link restores progress — ChipNet § Network splits).

**Record availability** (`tallynet-record-availability`). Three mechanisms together make a promised lift resolvable for every cooperating member: push to reachable peers both directions along the route (built); contact points (above); and a **pull** — a node may request the current record for a `transactionCode` from any contact point or direct neighbour, which replies with its merged copy (union merge is idempotent, so a pull is always safe). Guarantee: with **at most one** non-cooperating member and contact points on the originator and voters, every cooperating member obtains the outcome.

**Equivocation proof kept** (`tallynet-record-availability`, input to `feat-tallynet-hostile-peers`). A voter signing both faces of a phase (`C`&`NC`, or `P`&`NP`) is equivocation; the authoritative set still keeps only the first face (settlement unchanged), but **both** signed faces are now retained in a durable proof store (keyed by `transactionCode` + signer) rather than dropped. When a member finds its own settled outcome contradicts a neighbour's (it voided while a downstream node committed, or vice versa), the *remedy* is host policy, not protocol: a voided-but-downstream-committed member may stay voided and join a correcting lift; a committed-but-downstream-voided member may build a compensating reversal with its peers (ChipNet § Lying referees). TallyNet surfaces the proof and the contradiction; `feat-tallynet-hostile-peers` / `feat-lift-healing` act on them.

**Tally settlement verification — voters sign the record once (decided).** The alternative to per-edge signatures (which cost voters × edges). Each voter already signs the whole record once (its `commits[]` entry over the record digest); a tally then settles its edge by verifying three things, with **no** per-edge signature: (a) a deciding majority (per the record's threshold) of the record's voter set signed `C` over the record digest; (b) the record's topology contains this edge (this strand's link) with these terms; (c) the tally's host policy accepts the record's lift-contract CID. This retires the per-edge attachment below; **nothing changes in TallyNet** (voters already sign once), so it is a binding contract for `feat-tallynet-bind-taleus-core` to implement in the schema, not a `tallynet` code change. The `Signature.attachment` field stays as an opaque carrier other hosts may use.

### The commit attachment seam

*Current single-referee shape; retired by the voters-sign-once decision above (`feat-tallynet-bind-taleus-core`). Kept here until then.* The Taleus referee produces **two** signatures at commit: TallyNet's whole-record commit signature (an entry in the record's `commits[]`), and a **separate per-edge** signature the Quereus schema verifies to settle each strand (`packages/taleus-core/src/lift/referee.ts`, `RefereeCommit.edgeSignatures`, keyed by `LiftId`). The per-edge signatures must travel with the record so each strand's agent can copy its edge's signature into that strand's finalize row.

They cannot live in the record `payload`: `payload` is part of the immutable, promise-signed core, and the originator sets it *before* any referee has committed. So they ride as the **opaque `attachment`** on the referee's commit `Signature` (`src/consensus/types.ts`). The `attachment` is deliberately **not** part of the whole-record signed preimage (`recordDigest` covers only the immutable core plus — for a commit — the promise set), which matches `taleus-core`'s injected `RecordDigest`: it, too, signs only the core + promises, never the edge-signature bundle.

This is safe because the per-edge signatures are **self-authenticating at the host layer**: each verifies against the referee's known key under the schema's own digest (`liftTermsDigest` for commit, `liftVoidDigest` for void), independent of TallyNet's record signature. A stripped or swapped `attachment` therefore fails at the destination strand — a **liveness** concern (that edge cannot settle until a good copy arrives), never a **safety** one (no wrong settlement can be forged). The binding ticket (`feat-tallynet-bind-taleus-core`) maps `taleus-core`'s `RefereeCommit.edgeSignatures` / `RefereeVoidResult.edgeSignatures` onto the commit signature's `attachment` without further ceremony.

**Not in v1** (backlog): bidirectional search; ring/star propagation with a convergence node; pre-promise void on timeout; void-on-timeout and stalled-transaction recovery (coordinate with `feat-lift-timeout-release`); query economics and policing; advertising. v1 is unidirectional and push-to-reachable, and supports voter sets. Taleus's schema still holds a legacy single referee per edge; `feat-tallynet-bind-taleus-core` replaces it with voter sets when it binds.

*Implemented in `src/consensus/`: the record data model + opaque commit `attachment` (`types.ts`), the canonical two-phase digest (`digest.ts`), sign/verify (`signature.ts`), the durable record/peer-record/release-flag store (`store.ts`), the host resource port (`resource.ts`), the per-node state machine — validate → merge-by-union → promise/vote → release-once, with `outcome()` reading the settled commit/void (`participant.ts`), and the per-node `ConsensusNode` bundle on the public barrel (`engine.ts`). Atomic settlement across a whole route — commit-everywhere / void-everywhere under dropped pushes, sleeping nodes, referee sets, and equivocating/forged peers — is proven over the in-memory harness (`src/testing/`, driven in `src/testing/consensus.test.ts`). The `taleus-core` binding is `feat-tallynet-bind-taleus-core`.*

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
- **Simulated network**: an in-memory harness of N nodes wiring `queryPeer`/`updatePeer` directly, with injectable latency, drop and sleeping nodes. It should support a seeded random graph with assertions (ChipNet's 10k-node test asserted nothing). It ships as a platform-neutral subpath export, `tallynet/testing`, because the simulator builds on it. The harness's `buildLift` accepts an optional `routeLinkIds` (one exact link id per route hop) so a lift over **parallel tallies** between the same pair selects the intended edge instead of the first one found — a test/sim convenience for disambiguating parallel edges, not a protocol change.

## Simulation hooks

TallyNet is run at scale by `packages/tallysim` (thousands of nodes in one process, on simulated time) and watched through `packages/tallysim-viewer`. The engines serve that unchanged, with no test-only forks:

- **Clock port.** All time goes through an injected `Clock` (`now`, `setTimer`, `clearTimer`); the default is real time. Nothing else in `src/` reads `Date.now` or arms global timers.
- **Trace port.** An optional `TraceSink` receives typed `TraceEvent`s (query sent/received, candidate pruned with reason, plan returned/found, round budget expired, late answer folded in; record pushed, promise, vote, settle, release). Each event holds only what the emitting node already knows, so tracing adds no disclosure. A throwing sink is logged and ignored.
- **Determinism.** Under a seeded `RandomSource` and a virtual clock, a run is reproducible: no `Math.random`, and no behaviour that depends on unordered key iteration.
- **Adversarial consensus**: forged and replayed signatures, signature-type substitution, expired codes, duplicate members, a voter signing both commit and void, out-of-order and duplicated delivery, a node restarting mid-transaction.
- **Multi-denomination**: a route crossing two boundaries; a missing quote; an expired quote; rounding dust accrues to the originator only; the single-denomination case is unchanged.

## Working with the upstream source

The port reads ChipNet's source and docs; it does not depend on the package. Keep a checkout beside this repo:

```
git clone https://github.com/gotchoices/ChipNet ../chipnet    # from the taleus repo root; pin to 29fbc24
```

`doc/discovery.md` and `doc/cluster.md` there describe the designed-but-unbuilt features. Read them before planning any backlog item above.
