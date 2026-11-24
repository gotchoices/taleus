description: Bring over the route-finding half of ChipNet (searching outward through the network one step at a time for a path to a payee) into TallyNet, fixing its known bugs and making its saved state storable in a database.
prereq: tallynet-scaffold
files: packages/tallynet/, packages/tallynet/docs/design.md, packages/tallynet/docs/chipnet-review.md, packages/taleus-core/src/lift/agent.ts, packages/taleus-core/src/lift/discovery.ts
difficulty: hard
----

Port ChipNet's **unidirectional discovery** (`../chipnet/src/unidirectional/`, plus `intent.ts`, `plan.ts`, `member.ts`, `address.ts`, `target.ts`, `query-struct.ts`, `reentrance.ts`) into `packages/tallynet/src/discovery/`. The originator drives rounds; each round reaches one level deeper; each participant keeps per-session sub-query state between rounds. How it works today, and every known defect: `packages/tallynet/docs/chipnet-review.md` § Discovery, § Discovery defects. Target shape: `docs/design.md` § Protocol design.

## Design points to settle in this plan

- **Types.** Generic over link terms (`TTerms`) and plan payload. Intent codes are `string`. One link shape (`{ nonce, intents: Record<code, TTerms> }`), not ChipNet's two (`PlanLink` record vs `Link.intents` array).
- **State split.** A durable `ParticipantStore` (serialisable query context: query, plan so far, self, candidates `{linkId, nonce, depth, intents, lastResponse?}`, nonce→linkId map) and an in-memory in-flight table (`Pending` per candidate). Define what happens to a reentrance after a restart (in-flight lost → those candidates retried or dropped next round). Provide an in-memory `ParticipantStore` for tests.
- **Hop-context negotiation.** Leave the hook shape ready for `tallynet-multi-denomination` without implementing conversion: `negotiateIntent(ctx: { code, linkTerms, inboundTerms?, query }) → TTerms | undefined`, plus a pluggable `planSatisfies(query, plan) → boolean` replacing ChipNet's uniform `intentsSatisfied`, plus an optional `annotateReturn` hook called where ChipNet calls `prependMatch`. Default implementations give ChipNet's single-unit behaviour.
- **Time budget.** Use the real per-round budget (ChipNet hardcodes 1000 ms at `participant.ts:102`). Keep the Sparstogram/Pareto originator budgeting or replace it with something simpler and documented. Decide whether `sparstogram` stays as a dependency (check ESM + React Native compatibility) or a minimal histogram is inlined. Validate a peer's reported stats (bounds, monotonicity) before using them.
- **Engine API** that `taleus-core`'s `DiscoveryEngine.discover(query, callbacks)` port (`src/lift/agent.ts:131`) can wrap without contortion. Don't change taleus-core in this ticket; note the adapter shape for `tallynet-bind-taleus-core`.

## Edge cases & interactions (carry into the implement ticket(s))

- Cycles: a candidate whose nonce is already in the path is removed (ChipNet only reports it).
- Failed / errored / timed-out candidates are pruned; candidates with no remaining reentrance are dropped.
- The same session arriving twice by different paths: allowed (different path key) vs the same path twice: rejected.
- Max depth reached; session code expires mid-search; session code with too little life left (`minSessionMs`).
- A sleeping peer (never answers) is skipped by the budget, and its late answer is folded into the next round, not lost or double-counted.
- Target is self (circular lift: originator searches for itself); target is a direct peer; target unreachable (empty result, not an error).
- Participant restart between rounds (durable context present, in-flight gone).
- Inbound link nonce doesn't match plan tail → reject; reentrance with a mismatched session → reject; error messages don't disclose link ids.
- No leaked timers; concurrent sessions on one participant don't share state.

## Tests to plan

- Port ChipNet's 6-node happy path (`../chipnet/test/uni-discovery.test.ts`) with assertions on the plans found.
- Seeded random graph (hundreds of nodes) with assertions: every returned plan is a valid path, has no repeated nonce, ends at the target, and respects max depth.
- One test per defect in the review table (each fails on a naive port).

Split into implement tickets as needed (e.g. types + participant first, originator + budgeting second), chained by `prereq:`.
