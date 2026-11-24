# ChipNet review (upstream assessment)

What TallyNet is ported from, what is sound in it, and what is broken or missing. TallyNet's own intended design is in [design.md](design.md); this file is reference material about the source, not about TallyNet.

**Source:** [gotchoices/ChipNet](https://github.com/gotchoices/ChipNet) at commit `29fbc24` (2024-11-05, "More aggressive pushModified"); untouched since. Author Nathan Allan; MIT. About 1,650 lines of TypeScript in `src/` and about 600 in `test/`. Line references below are to that commit. Work from a local checkout (see [design.md § Working with the upstream source](design.md#working-with-the-upstream-source)).

## Summary

ChipNet is a *meta-protocol*: it runs route discovery and a promise/commit consensus, but the host supplies messaging, persistence, the meaning of link terms and resource holds, all through callbacks. That shape is right for Taleus and is kept. The code itself is prototype grade:

- **Discovery** (unidirectional) works for its happy path, but several filters are no-ops and its time budget is pinned to a debug constant.
- **Transaction/consensus** has no tests, and its signature verification does nothing (see [Transaction module defects](#transaction-module-defects)).
- **Much of what the design docs describe is not built**: bidirectional search, ring/star propagation, pre-promise void, timeouts, stalled-transaction recovery, query economics.
- **Packaging** is CommonJS in practice, Node-only and not published to npm.

The decision is therefore **port the concepts and the callback shapes, rewrite the code** with tests, in this repo. Note that `docs/architecture.md` § *Why reuse, not reboot* credits ChipNet with ring/star voting, void-on-timeout, network-split and lying-referee handling, and query economics. Those exist in ChipNet's *docs*, not its code. TallyNet has to build them (or decide not to).

## Layout

```
src/
  types.ts address.ts intent.ts plan.ts member.ts topology.ts target.ts private-link.ts
  query-struct.ts      request/response shapes + callback types (QueryPeerFunc, NegotiateIntentFunc, NegotiatePlanFunc)
  rule.ts              tiny rule engine (named async rules with dependencies), used for query validation
  sequencing.ts        budgetedStep: await a batch of requests up to a time budget
  pending.ts           Pending<T>: a promise wrapper exposing isComplete/response/error/duration
  requester.ts responder.ts receiver-responder-message.ts   message-id correlation helpers (unused internally)
  serialize.ts deep-equal.ts hash-deep.ts trace.ts reentrance.ts
  unidirectional/      discovery: UniOriginator, UniParticipant, state interfaces + in-memory impls
  transaction/         consensus: TrxParticipant, TrxRecord, state + resource interfaces
  bidirectional/       originator.ts is an empty class
doc/
  discovery.md cluster.md discovery/{time-sync.md,logical-clock.md,todo.md} cluster/todo.md figures/
```

Dependencies: runtime `chipcryptbase` (interfaces only) and `sparstogram` (timing histogram; on npm, 0.8.2); dev `chipcrypt`, `chipcode`. Node `crypto` is imported directly in `requester.ts:1`, `hash-deep.ts:1` and `transaction/participant.ts:5`.

## Concepts and data model

- **Address** `{ key, cuid? }` (`address.ts`). `key` is a base64 public key used for both encryption and signature verification; `cuid` optionally narrows identity.
- **Member** `{ address, physical?, secret?, types: ('P'|'R')[], noCache?, dependsOn? }` (`member.ts`). `P` = participant (must promise), `R` = referee (votes commit). `physical` is a multiaddr the member can be dialed at directly. `dependsOn` lets a participant nominate referees or relays.
- **Link / PrivateLink / PlanLink.** A host's real edge is a `PrivateLink { id, intents }`. On the wire an edge is only ever a **nonce** = `makeNonce(linkId, sessionCode)`, a salted hash, so intermediaries can recognise an edge they hold but learn nothing about others. `PlanLink { nonce, intents }`.
- **Intents** `Record<'L'|'C', Terms>` (`intent.ts:3-4`), with `Terms = Record<string, unknown>` (`types.ts:3`). `L` = lift capacity, `C` = communications. Terms are opaque to the library.
- **UniQuery** `{ target: PublicTarget, sessionCode, intents }`. `PublicTarget` carries the target address and an optional secret encrypted to the target's key.
- **Plan** `{ path: PlanLink[], members: DependentMember[], payload? }` (`plan.ts`). `path` grows on the way **out**, one link per hop; `members` are prepended on the way **back** (`prependMatch`, `unidirectional/participant.ts:339-365`).
- **Topology** `{ members, links: Record<nonce, Link{source,target,intents: Intent[]}> }` (`topology.ts`). This is the transaction-time view. Note `Link.intents` is an `Intent[]` while `PlanLink.intents` is a record: two shapes for one idea.
- **TrxRecord** `{ transactionCode, sessionCode, payload: unknown, topology, promises: Signature[], commits: Signature[] }` (`transaction/record.ts:13-20`). `Signature { type: 'P'|'NP'|'C'|'NC', address, value }`.

## Discovery (unidirectional)

**Originator** (`unidirectional/originator.ts`). `discover(target, intents)` generates a session code, encrypts the target secret, then calls **its own local participant** repeatedly: first with an `entrance` request, then with the returned `reentrance` ticket, up to `maxDepth` (7). Each round it checks `intentsSatisfied` against returned plans and stops when satisfied or when there's no reentrance. Between rounds it computes the next time budget from returned timing statistics (Sparstogram + Pareto quantile, lines 66-112). `validatedStats` is a TODO stub (line 62).

**Participant** (`unidirectional/participant.ts`). Constructed with options, state, `AsymmetricVault`, `CryptoHash`, `findAddress(query, inLinkId)`, `intentSatisfied` and `queryPeer`.

- **First visit** (`enter`, line 31):
  1. Validate the request with a `RuleSet` (session code valid and long-lived enough; empty plan iff no inbound link; inbound link's nonce matches the plan tail).
  2. Reject duplicate visits (`state.validateNewQuery`).
  3. `createContext` (line 130): call the host's `findAddress`, which returns self, whether self matches, peer matches (a neighbour *is* the target) and candidate links. Compute nonces for all of them, negotiate intents on candidates against the query, build plans for any matches, then save the context.
  4. Return plans found so far plus a reentrance ticket if candidates remain.
- **Re-visit** (`reenter`, line 53):
  1. Restore the context.
  2. Harvest any sub-requests that completed since the last round; return early if they satisfy the query.
  3. Otherwise send the next step: an `entrance` to untried candidates (with this hop's link appended to the plan) or a `reentrance` to candidates that returned one.
  4. Await them with `budgetedStep`, collect plans, prepend self as a member, save the context, and return.

The result is a breadth-first search advanced one depth level per originator round, with each node keeping its own sub-query state between rounds.

**State interfaces.** `UniParticipantState` (`participant-state.ts:6-35`): validateNewQuery, get/saveContext keyed by `(sessionCode, path)`, peer overhead get/report, reportCycles, reportTimingViolation, getNonceToLinkMap. `UniOriginatorState`: learned budget growth. There are in-memory implementations of both.

**Negotiation hooks.**
- `NegotiateIntentFunc(linkIntent, queryIntents) → Intent | undefined` (`query-struct.ts:62`) is applied to each candidate's and each match's link intents, always against the **original query's** intents.
- `NegotiatePlanFunc(plan) → Plan | undefined` is optional and lets a node vet or extend a plan, e.g. adding referees (`participant-options.ts:13`).
- `IntentSatisfiedFunc(queryTerms, planTerms)` is applied per link by `intentsSatisfied` (`intent.ts:10-18`). It requires **every** link of some plan to satisfy the **same** query terms.

### Discovery defects

| Where | Problem |
|---|---|
| `unidirectional/participant.ts:102-103` | `await budgetedStep(1000, requests)`: hardcoded debug budget; the real `budget - elapsed` is commented out. |
| `unidirectional/participant.ts:233-244` | Cycle detection builds a set of **linkIds** and then filters by `cycles.has(c.nonce)`. Cycles are reported but never removed. |
| `unidirectional/participant.ts:113` | Prune filter `!r \|\| !r.isError \|\| !r.isResponse \|\| …` is true for nearly everything, so failed candidates are never pruned. |
| `unidirectional/memory-participant-state.ts:25,32,40` | `validateNewQuery` checks a flat `session:path` key against a map nested by session, so duplicate-query rejection never fires. |
| `sequencing.ts` | `budgetedStep` never clears its `setTimeout`, so one timer leaks per step (this keeps a Node process or jest worker alive). |
| `unidirectional/participant.ts:167` | Builds plans with a `sessionCode` field that `Plan` does not declare. |
| `unidirectional/originator.ts:62` | `validatedStats` is a stub, so a peer's reported timing is trusted outright. |
| `unidirectional/active-query.ts:14`, `query-context.ts:12` | `QueryContext` holds live `Pending<QueryResponse>` promises and passes them to `saveContext`. A durable (SQL) state can't persist that. The in-flight layer must be split from the durable context. |
| `unidirectional/response.ts` | `UniResponse` is unused. `requester.ts`/`responder.ts`/`serialize.ts` are unused internally. |

## Transaction (promise/commit consensus)

`TrxParticipant` (`transaction/participant.ts`) is constructed with state, `AsymmetricVault` (our signer), `Asymmetric` (verifier), `CryptoHash`, `updatePeer(address, record)`, `TrxParticipantResource` and the discovery session's `nonceToLinkMap`.

`update(record, fromAddress?)` (line 31):
1. Load the prior record and `validateAndMerge`. A new record needs valid transaction and session codes. An update must match payload and topology exactly, and signatures are unioned (a changed signature throws).
2. If unchanged, just re-push to peers.
3. Otherwise, if we are a member, loop `advanceState` until it stops changing the record:
   - `getRecordState` (line 215) classifies the record: `rejected` if any non-promise signature; `ourPromiseNeeded`; `promising` (waiting on others); then over commits, `rejected` on a no-commit majority, `ourCommitNeeded` (we are a referee), `consensus` on a commit majority, else `propagating`.
   - `ourPromiseNeeded` → `resource.promise(...)` then sign `P` or `NP`.
   - `ourCommitNeeded` → sign `C` or `NC`.
   - `consensus`/`rejected` → `resource.release(success, …)` once (`setIsReleased`).
4. Push the record to "reachable peers" (`reachablePeers`, line 140): members with a `physical` address, plus our direct link neighbours. Skip peers whose last known copy is equal.

Digests come from `createDigest` (line 297): sha256 over transactionCode, sessionCode, `hashDeep(payload)`, `hashDeep(topology)` and extra strings. The commit digest additionally covers each promise as `JSON.stringify(p)`.

`TrxParticipantResource` (`participant-resource.ts:12-21`) is where the host holds and releases value: `shouldPromise?`, `promise` (throw to refuse), `shouldCommit?`, `release(isSuccess)`. Each receives our member and our in/out `TrxLink`s (`{ nonce, linkId?, link }`).

`TrxParticipantState` (`participant-state.ts:4-19`): self; save/get record; get/save peer record; is-released flag; three loggers.

### Transaction module defects

These were verified by reading the source, not inferred.

| Where | Problem |
|---|---|
| `transaction/participant.ts:224,255` | `if (!this.verifyDigest(...))`: `verifyDigest` returns a `Promise`, never awaited, always truthy. **No signature is ever verified.** |
| `:159,173` vs `:222,253` | Signing hashes `[sigType]` into the digest; verifying does not. Once verification is awaited, every signature fails. The two bugs currently mask each other. The signature type must be bound into what is signed, and verify must recompute the same preimage. |
| `:151-153,169-171` | `!expired(tx) && !expired(session) && this.resource.shouldX ? await shouldX(...) : true`. Because of precedence, an expired code **or** an absent `shouldX` gives `approved = true`. |
| `:75-77` | `resource.promise` (hold resources) runs **before** `shouldPromise` decides; a declined promise still holds resources until release. |
| `:285-287` | `isConsensus(n, total) = n >= ceil(total/2)`: `(0,0)` is true, so a topology with no referees resolves as `rejected`; an even split satisfies both outcomes and reject wins because it is tested first. |
| `hash-deep.ts` | Concatenates keys and values with no delimiters or type tags (`{a:'bc'}` and `{ab:'c'}` hash alike); arrays hash as objects with lexically sorted index keys. Not a safe preimage for signatures. Use a canonical encoding (e.g. deterministic CBOR or JCS) instead. |
| `:315` (`getCommitDigest`) | Promises enter the commit preimage as `JSON.stringify(p)`: key-order dependent, not canonical. |
| `:105` | Throws if our address appears more than once in a topology (a circular lift through the originator does this; acknowledged in `doc/cluster/todo.md`). |
| `:133-134` | `logUpdateError` called twice. |
| `:210-212` | TODOs: intents span plans, terms match across plans, still amenable to terms. Nothing checks terms at transaction time. |
| `test/trx-scenario.ts` | Doesn't compile (missing `TrxParticipantOptions`, undefined `linkId`/`request`). `test/transaction.test.ts` is entirely commented out. Dummy resources in tests don't match the interface. |

## Designed but not implemented

From `doc/discovery.md`, `doc/cluster.md` and the two `todo.md` files:

- **Bidirectional search** (originator and target both search; probes meet). `bidirectional/originator.ts` is empty.
- **Ring/star propagation**, convergence node, **pre-promise void (PPV)** on timeout, void-on-timeout at commit, referee "extra votes", **stalled-transaction recovery**. The code only signs and pushes to reachable peers.
- **Exceptions**: dead referees, lying referees, network splits (cluster.md § Exceptions). These are described only.
- **THIST time sync** (`doc/discovery/time-sync.md`) and the **adaptive logical clock** (`logical-clock.md`) are partly reflected in the timing stats, but bypassed by the 1000 ms constant.
- **Query economics / policing**: quotas, metrics, down-ranking slow peers. **Advertising** of open balances to neighbours.
- Verifying the target's signature against its address; "whispering" identity checks.

The design docs are still the best statement of intent for these and should be read before planning them.

## Platform and packaging

- `package.json` has no `"type": "module"`, so `tsc` with NodeNext emits **CommonJS**, though the readme says ESM. 80 of 111 relative imports lack `.js`. Barrel cycles: `from ".."` / `from "."` in `target.ts:1`, `topology.ts:1`, `unidirectional/participant.ts:4-5`.
- Node `crypto` (`randomBytes`, `createHash`) means it won't run in React Native or the browser as is.
- `chipnet` and `chipcryptbase` are **not on npm** (404), and installing from GitHub fails (no committed `dist/`, no `prepare`).
- Tests: jest/ts-jest. Of 4 suites, only Responder, Requester and a 6-node discovery happy path test anything real. A 10k-node random network test makes no assertions. There are no transaction tests.

## Sibling packages

| Package | What it is | Verdict for TallyNet |
|---|---|---|
| **ChipCryptBase** (`chipcryptbase@0.1.15`) | Interfaces only: `Asymmetric`, `AsymmetricVault`, `Symmetric(Vault)`, `CryptoHash`, `KeyPair`; base64 helpers. No deps. | Don't depend on it. TallyNet defines its own minimal crypto ports. `taleus-core`'s `CryptoProvider` (`packages/taleus-core/src/crypto/provider.ts`) already mirrors it on `@noble/*` (sha256, ed25519). |
| **ChipCrypt** (`chipcrypt@0.1.6`) | secp256k1 ECDSA + ECIES, AES-256-GCM; uses the native `secp256k1` addon and Node `crypto`. | Not used. Wrong curve (Taleus is ed25519) and Node-only. |
| **ChipCode** (`chipcode@0.1.10`) | `CryptoHash` impl: 32-byte random **session codes** with an embedded expiry (10 s granularity), a randomness check (entropy, frequency and runs tests), `makeNonce = base64(sha256(code ‖ payload))`. Node `crypto`. | Re-implement the idea (about 100 lines) on `@noble/hashes` + `crypto.getRandomValues`. `computeNonce` in `packages/taleus-core/src/transport/chipnet-protocol.ts` already does the nonce. |

All three, like ChipNet, are CommonJS in practice (`"target": "module"` is a typo for `"type"`).

## What is worth keeping

- The callback boundary: host supplies `findAddress`, `queryPeer`, `updatePeer`, state stores, negotiation and resource hooks. Taleus's existing adapters were written against exactly these (see [design.md § The seam taleus-core already defines](design.md#the-seam-taleus-core-already-defines)).
- Nonce anonymisation of edges per session.
- Step-wise BFS with per-node sub-query state and reentrance tickets, which keeps each node's fan-out local and private.
- Building the path outward and the member list on the return trip: the return trip is where each node knows both its in-edge and its chosen out-edge.
- A self-describing record (payload + topology + signature lists) merged by union, so the protocol tolerates any delivery order.
- The `RuleSet` helper for explainable validation.
- The Pareto/histogram time-budget idea (once it is actually wired and its stats validated).
