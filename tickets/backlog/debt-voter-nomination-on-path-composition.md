description: In the tally-network simulator, the two ways a node can pick who vouches for a payment don't actually work once wired up — a node vouching for itself gets the payment rejected, and vouching for a busy hub silently drops the vouch — so both need rethinking before the voter model can run.
prereq: tallysim-voter-policies
files: packages/tallysim/src/sim/well-known.ts, packages/tallysim/src/sim/well-known.test.ts, packages/tallynet/src/testing/network.ts, packages/tallynet/src/discovery/participant.ts, packages/tallynet/src/consensus/participant.ts
difficulty: medium
----

## The problem

`makeNomineesFor(network, wellKnown, policy)` in `packages/tallysim/src/sim/well-known.ts` builds the
per-node "who does this node nominate as a voter (referee)" function the simulator will hand the discovery
harness. It offers two policies, `'self'` and `'well-known'`. Both are **pure and internally correct** (they
build the `RefereeNomination[]` shape they claim), but the *model* they encode does not compose with how the
`tallynet` harness turns a nomination into a voting member. The policy functions are not yet wired into a
running lift (that is ticket `tallysim-voter-harness-drive`), so this is dormant today — but it is
**definitely wrong the moment either policy drives a real lift**, confirmed from the `tallynet` source, not
speculative.

### How nomination actually folds (the mechanism)

- A node's discovery `self` match is always declared **participant-only** (`[P]`) — `makeFindAddress` in
  `packages/tallynet/src/testing/network.ts` hard-codes `types: [MemberTypes.participant]`. A discovery
  participant can never declare itself `[P,V]`.
- A nomination becomes a **separate** voter-only (`[V]`) member via `prependMatch`
  (`packages/tallynet/src/discovery/participant.ts`). `prependMatch` only de-duplicates a nominee against
  members **already present** on the plan, and even then it merges `physical`/`secret` only — it never
  merges `types`. So an already-present participant stays `[P]`; a not-yet-present nominee is appended as a
  fresh `[V]` member.
- The established, tested pattern (see `nomineesFor` cases in
  `packages/tallynet/src/testing/consensus.test.ts`: "the line O—A—B—Z plus an edge-less R") is that a
  referee is a **separate node OFF the money path**. Node `A` nominates node `R`; `A` never nominates
  itself or another on-path node.

### Why each policy breaks

- **`'self'` — always broken.** Each node nominates itself. At that node's own prepend step it is not yet in
  `plan.members`, so it is added **twice**: once as the `[P]` self member and once as the `[V]` nominee, both
  keyed by the same node name. The resulting topology has a duplicate member key, which `tallynet`'s
  `NoDuplicateMembers` validation rule (`buildNewRecordRules` in
  `packages/tallynet/src/consensus/participant.ts`, message `"Duplicate member entry in topology"`) **rejects
  outright** — the record never forms, so the lift cannot settle. (Even if validation were lifted,
  `weAre('V')` resolves a node's role via `memberByKey` = the *first* member with that key = the `[P]` one,
  so the node would never cast its own commit vote and the quorum would stall.)
- **`'well-known'` — broken whenever the hub is on the route.** Every node nominates the single
  highest-degree hub. A hub is high-degree precisely because it sits on many routes, so it is frequently an
  **on-path participant** for the lift being formed. When it is, the `[V]` nomination either collapses into
  the already-present `[P]` member (vote silently lost) or duplicates its key (rejected, as above), depending
  on fold order. It works correctly only when the chosen hub happens to be off the particular route.

## What a fix looks like (for whoever picks this up)

The voter-set model needs a way to mark an **on-path participant as a voter** (`[P,V]`) directly, instead of
routing on-path votes through the off-path referee-nomination mechanism. Options to weigh:

- Give the simulator's discovery-member construction a "this participant also votes" path that yields a
  single `[P,V]` member (the clean representation `mint.ts` already documents as the intended shape), and
  reserve `makeNomineesFor` strictly for genuinely off-path referees.
- Or change `'well-known'` to nominate a hub only for nodes whose route does **not** already include it, and
  drop or redefine `'self'` (a "voter-set-of-one" where each participant votes its own leg is a `[P,V]`
  marking, not a self-referee).

Decide this together with `tallysim-voter-harness-drive`, which is the ticket that first wires
`makeNomineesFor` and whose "a node nominates a well-known voter" test currently assumes an off-path nominee.
A code `NOTE:` at `makeNomineesFor` points here.
