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

## Regression check: TallyNet vs ChipNet, feature by feature

TallyNet was rewritten from ChipNet rather than adopted (ChipNet's code had the defects above). This section is the systematic check that the rewrite **kept everything ChipNet got right** — done by reading both code bases and ChipNet's `doc/` in full (`tallynet-chipnet-regression`, 2026-11-25). Both discovery (`../chipnet/src/unidirectional/` ↔ `src/discovery/`) and consensus (`../chipnet/src/transaction/` ↔ `src/consensus/`) were compared line by line.

**Headline:** no correctness regression. Every ChipNet behaviour that actually *did* something is preserved or improved; everything dropped was a no-op, dead code, or a deliberately-removed attack surface with a stated reason (see the table). The audit surfaced exactly **one** silent behavioural loss (push echo-suppression), a handful of ChipNet-designed-but-never-built features that no TallyNet ticket yet owns, and two test-coverage gaps. These are ticketed below the table.

Status legend: **kept** (same behaviour), **improved** (TallyNet better, by design), **dropped-reason** (removed deliberately, reason stated), **regression** (ChipNet working behaviour lost with no stated reason), **not-built** (designed in ChipNet's *docs* only; built in neither — names the TallyNet ticket that picks it up, or flags it unowned).

### Discovery

| Feature | ChipNet code | TallyNet | Status |
|---|---|---|---|
| Round/level accounting (`≤ maxDepth`, one level per round, reach `= L` hops) | `unidirectional/originator.ts:32`, `participant.ts:157,310` | `discovery/originator.ts:128`, `participant.ts:343,361` | kept |
| `maxDepth` authoritative on the query (every node agrees on the ceiling) | local participant option only (`participant.ts:311`) | rides on `UniQuery` (`discovery/types.ts:90`) | improved |
| Behaviour at the depth ceiling | **throws** out of `discover` (`participant.ts:311`), breaking the never-throw-for-not-found contract | `concludeMaxDepth` returns accumulated plans, no reentrance (`participant.ts:526`) | improved (ChipNet bug) |
| Cycle removal | **no-op** (set of linkIds filtered by nonce, `participant.ts:233-244`) | real prune, `candidate-pruned`/`cycle` (`participant.ts:234-238`) | improved (fixed) |
| Failed-candidate prune | **no-op** (`!r\|\|!r.isError\|\|…` keeps all, `:113`) | `pruneCandidates` drops `failed`/`no-reentrance` (`participant.ts:491`) | improved (fixed) |
| Duplicate-query rejection | **no-op** (flat key vs nested map, `memory-participant-state.ts:25`) | one `contextKey` throughout (`discovery/store.ts:79`) | improved (fixed) |
| `prependMatch` member assembly (self + `dependsOn` nominees on return) | `participant.ts:339-365` | `participant.ts:697-725` (near line-for-line) | kept |
| Return-path annotation hook (`annotateReturn`) — amend own in-edge before prepend | — | `discovery/hooks.ts:55`, `participant.ts:478` | improved (new; multi-denomination seam) |
| `negotiateIntent` with hop context (`inboundTerms`) | per-link vs original query only (`query-struct.ts:62`) | `hooks.ts:31`; default ignores hop (single-unit parity) | improved |
| Plan satisfaction | per-link same-terms; codes can be split across plans (`intent.ts:11`) | whole-plan `planSatisfies`, one plan carries all codes (`hooks.ts:44`) | improved (fixes cross-plan quirk) |
| `negotiatePlan` whole-plan vet/extend (add referees) | `query-struct.ts` opt | `hooks.ts:61` | kept |
| Peer-match terminus (neighbour is the target; final hop same round) | `participant.ts:159-173` | `participant.ts:278-297` | kept |
| Late-answer folding / sleeping nodes across rounds | `participant.ts:101` (budget hard-coded `1000`) | `harvest` + `late-answer-folded` trace (`participant.ts:375`); real budget | kept (budget fixed) |
| `budgetedStep` timer hygiene | leaks one `setTimeout` per step (`sequencing.ts:9`) | clears in `finally`, abort signal (`sequencing.ts`) | improved (fixed) |
| Plan dedupe (by path) | none — can emit duplicates (`participant.ts:121`) | `foldPlans` `seen` set (`participant.ts:443,728`) | improved (new) |
| Histogram/Pareto adaptive budget + trusting peer `QueryStats` | `originator.ts:62-112`, `validatedStats` stub trusts peers | linear budget; `QueryStats` informational-only (`types.ts:108`) | dropped-reason (design.md § Time budget; `feat-tallynet-adaptive-budget`) |
| `recordGrowth`/`UniOriginatorState`, `reportOverhead`, `reportTimingViolation` | present but **dead/untrusted** (never wired into control flow) | dropped (`discovery/store.ts:16`) | dropped-reason |
| Target-secret encryption inside `discover` | `originator.ts:27` (AsymmetricVault) | host pre-encrypts `Target.secret`, passed through | dropped-reason (seam moved host-side) |
| `getNonceToLinkMap` (nonce→link for the commit engine) | `memory-participant-state.ts:78` | `discovery/store.ts:108` | kept |
| Whole-path intent **trimming** at a match node (rewrite every link to the code intersection) | `processAndFilterPlans` (`participant.ts:187-212`) | not ported — negotiates only own links | **not-built (conditional)** — a no-op for single-denomination (one `L` code); only differs for multi-intent plans. Belongs to `feat-tallynet-multi-denomination`; see NOTE there. TallyNet's non-rewrite is arguably *more* correct (a node re-negotiating another node's terms is an ownership oddity) |

### Consensus

| Feature | ChipNet code | TallyNet | Status |
|---|---|---|---|
| Voter/referee set = members whose `types` include `R`; majority over distinct referees | `getReferees`, `isConsensus` (`transaction/participant.ts:285,293`) | `membersWithRole('R')`, strict `>R/2` (`consensus/participant.ts:421,433`) | kept |
| Strict majority both ways; empty referee set invalid; even split settles neither | `isConsensus(n,total)=n≥⌈total/2⌉`: `(0,0)=true`, even split satisfies both, reject tested first (`:261,285`) | strict `>R/2` both ways; `NonEmptyRefereeSet` rule; order-independent (`:433,769`) | improved (fixes even-split + majority-of-zero) |
| `dependsOn` nominees folded into `plan.members` (discovery return trip) | `prependMatch` (`unidirectional/participant.ts:362`) | `prependMatch` (`discovery/participant.ts:722`) | kept (identical) |
| Plan → `TrxRecord.topology` assembly (union self-votes + `dependsOn` into the member set) | **absent as library code** (only the non-compiling `test/trx-scenario.ts`) | **absent as library code**; harness `buildLift` builds members from a spec (`testing/network.ts:392`) | not-built (symmetric; **not** a regression — the originator's job, owned by `tallynet-voter-model` + `feat-tallynet-bind-taleus-core`; today untested end-to-end) |
| `reachablePeers` (members with `physical` + both link directions) | `participant.ts:140-148` (dups, unsorted, no self-guard) | `participant.ts:649-668` (deduped, self-excluded, sorted) | improved (identical set; deterministic + self-push guard) |
| Evidence propagates from wherever a majority first assembles; nothing routes through originator | `reachablePeers` push | `reachablePeers` push (same) | kept |
| Release-once, success gate, flag set only after `release` resolves | `releaseResource` (`:90-99`) | `releaseOnce` (`:571-585`) | kept |
| Record/signature shape | `record.ts:7-20` | adds opaque `attachment`; one link shape; `Address` drops `cuid` (`consensus/types.ts`) | improved / dropped-reason |
| Merge of a bad/changed/duplicate signature | **throws the whole `update`** (`mergeSignatures:326`, `getRecordState:218,250`) | drops the single signature, continues (`rejectSignature`); core-change still throws | improved (per-signature robustness) |
| Out-of-order commit (arrives before all promises) | **throws** "commit on un-promised transaction" (`:241`) | durable per-referee side pool, promoted after verifying vs complete promise set (`:309,366`) | improved (forged-commit-shadows-vote fix) |
| Signed preimage | `sha256(hashDeep(...))`, commit adds `JSON.stringify(promises)` (`:297-318`) | DAG-CBOR canonical, kind bound in, commit binds canonical promise set (`digest.ts`) | improved (safe preimage; every verify awaited) |
| State machine states | `promising/ourPromiseNeeded/ourCommitNeeded/consensus/rejected/propagating` | identical enum (`participant.ts:97`) | kept (1:1) |
| Circular lift through originator (member on >1 link) | **throws** on 2nd occurrence (`findOurMember:105`) | one member entry, many links allowed; duplicate *member key* is the invalid case | improved |
| Expiry / missing hook ⇒ refuse (never approve) | precedence bug approves on expiry/absent hook (`:151,169`) | expiry signs `NP`/`NC` first; absent hook defaults true only when not expired (`:531,554`) | improved |
| Hold resources only after the gate decides | `resource.promise` runs before `shouldPromise` (`:75-77`) | `shouldPromise` then `promise` (`:528-543`) | improved |
| Inbound peer-record save (suppress echoing an unchanged record back to its sender) | `update` saves `savePeerRecord(fromAddress, record)` first (`:34`) | `fromAddress` used only for the trace; peer record saved only after an outbound push (`:627`) | **regression** (minor; `bug-tallynet-push-echo-suppression`) |
| Invalid-record logging | `logInvalid` logs the whole record on any validation throw (`:65`) | `update` has no try/catch; only `core-mismatch` emits a trace; rule throw propagates unlogged at the participant boundary | **regression** (minor, logging; folded into `bug-tallynet-push-echo-suppression`) |
| Equivocation (a voter signs both faces) keeps **both** as proof | throws the whole record (keeps nothing) | refuses 2nd face, keeps 1st, **drops** 2nd (`rejectSignature`) | not-built — design.md § Lift design principles says "its proof kept"; that is **aspirational**, built by `tallynet-voter-model` + `feat-tallynet-hostile-peers`. Not a ChipNet regression (ChipNet kept no proof either) |
| Expanded new-record validation (members, links, participant/referee non-empty, self-consistency, encodability) | tx/session code validity only (`:199`) | `RuleSet` of 8 rules (`:751`) | improved |

### Designed in ChipNet's docs, built in neither — ticket coverage

From `../chipnet/doc/{discovery,cluster}.md` and the two `todo.md` files. Each is **docs-only** in ChipNet (its code never built them). "Owner" is the TallyNet ticket that picks it up; **unowned** means no ticket and no recorded decision-not-to-build.

| Designed feature | What it is (plain language) | Owner |
|---|---|---|
| Bidirectional / omnidirectional search | Payer and payee both search; frontiers meet — far faster | `feat-tallynet-bidirectional-search` |
| Ring/star propagation + convergence node | Promise/commit travels both ways around the loop, meeting at one node | `tallynet-propagation-timeouts` (decides if needed vs circuit+fetch) |
| Pre-promise void on timeout; void-on-timeout at commit; timeout backoff | A party that waits too long signs void; deadline resolves a stuck tie | `tallynet-propagation-timeouts` |
| Stalled-transaction recovery (periodic re-reach / fetch record) | Keep re-reaching peers until the record settles | `tallynet-propagation-timeouts` (+ schema half `feat-lift-timeout-release`) |
| Dead referees / network splits | Majority of voters offline, or an island with a minority, stalls until a link returns | `tallynet-propagation-timeouts`; inconsistent-resolution repair `feat-lift-healing` |
| Referee "extra votes" (require added peer voters as a term) | A node can demand extra voters to take part | `tallynet-voter-model` |
| Lying referees (equivocation) + remedies | A voter commits to some, voids to others; keep proof, repair | `tallynet-voter-model` + `feat-tallynet-hostile-peers`; measured by `tallysim-hostile-actors` |
| Query economics / policing / quotas; "don't escalate depth while all candidates in-flight" | Charge queries, cap fan-out, down-rank slow peers, rate-limit neighbours | `debt-tallynet-query-economics` + `feat-tallynet-hostile-peers` |
| Advertising open balances to neighbours | Push open lift capacity so searches start warm | `debt-tallynet-query-economics` (names it) |
| THIST time-sync / adaptive logical clock | Cross-node clock offsets; order-based clock for time-travel testing | adaptive budget → `feat-tallynet-adaptive-budget`; the logical clock is effectively **built** (`src/testing/clock.ts` `VirtualClock` + injected `Clock` port) |
| Verify the target's signature against its address; "whispering" identity checks | Confirm the party answering as the target actually holds that key; peer-of-peer identity confirmation | **unowned → `feat-tallynet-identity-verification` (new backlog)** |
| Path / address caching | Cache disclosed addresses to shorten future searches | **unowned → `feat-tallynet-discovery-caching` (new backlog)** |
| Portals; comms-vs-lift intent priority; target anonymising nonce; stale-query GC; B+Tree state | Smaller discovery refinements | soft-adjacent to `feat-tallynet-bidirectional-search` / `feat-tallynet-lift-identity-options`; minor — no ticket until a step needs them |

### Tests ChipNet exercises that TallyNet's don't

ChipNet's consensus tests never compiled or ran (`test/transaction.test.ts` commented out; `test/trx-scenario.ts` does not compile), so TallyNet's consensus suite has no ChipNet counterpart to regress against — it vastly exceeds it. For discovery, the one scenario ChipNet ran that TallyNet does not is **scale**: ChipNet's 10 000-node / 70 000-link graph (which asserted nothing, on unseeded randomness) vs TallyNet's largest **seeded, asserting** graph at 1 000 nodes / 2 000 links — an order of magnitude smaller and ~3.5× sparser. Mixed/comms-intent (`C`, or `L`+`C`) routes are untested on **both** sides despite TallyNet's extensible intent codes. Both are coverage gaps, not regressions → `debt-tallynet-discovery-scale-intent-tests`.
