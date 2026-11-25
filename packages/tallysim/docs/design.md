# TallySim design

TallySim is the Taleus **tally-network simulator**. It exists to answer Taleus's central research
question in two independent halves:

1. **Network shape** — *how connected must a tally network be before a payment can usually find a route
   through it?* This is measured by an **oracle** that sees the whole network and searches it directly.
2. **Protocol behaviour** — *does the real, decentralised routing protocol (`tallynet`) find the routes the
   oracle proves exist?* This is measured by replaying the protocol on the same networks (later tiers).

The two are kept deliberately apart (see [Tiers](#tiers)). This document is the canonical design; it grows
one tier at a time. This file currently covers the **network-model tier** — the data model, the capacity
model, the generators, and the structural utilities. Later tiers fill the stubbed sections.

Read first: [`docs/architecture.md`](../../../docs/architecture.md) (the Taleus system overview) and
[`packages/tallynet/docs/design.md`](../../tallynet/docs/design.md) (the lift protocol this simulator
measures).

## Tiers

Causation separates the question into tiers that do not share code paths, so a failure in one is never
confused with a failure in the other:

| Tier | What it does | Status |
|---|---|---|
| **Network model + generators** | Build random tally networks as plain data. | built |
| **Oracle** | See the whole graph; answer *does a route exist / how much is payable / can debt clear* by direct search. The **ground truth**. | built |
| **Runner / experiments** | Sweep a parameter over many generated networks, run the oracle per query, record metrics, check in findings. | later (`tallysim-runner`) |
| **Discovery / consensus** | Replay the real `tallynet` protocol on the same graphs and compare "found vs. oracle". | later (`tallysim-discovery`, `tallysim-consensus`) |

The oracle answers *could the network ever have carried this lift*; the protocol tiers answer *did the
protocol find it*. Keeping the oracle independent of the protocol is the whole point — it is the yardstick.

## Package conventions

Unscoped Yarn-workspace package `tallysim`, modelled on `packages/tallynet`: ESM (`"type": "module"`,
`.js` import specifiers), TypeScript strict, tabs, single quotes, jest + ts-jest. Root `yarn build` /
`yarn test` / `yarn lint` pick it up automatically.

- **One sibling dependency: `tallynet`** (`workspace:^`). It never depends on `taleus-core`. This tier uses
  only `tallynet`'s seeded PRNG; later tiers also use its discovery engine and testing harness.
- **Platform-neutral core.** TallySim runs in Node *and* the browser (the viewer runs simulations live in a
  page), so the core imports no Node globals. A guard (`src/no-node-globals.test.ts`) greps every non-test
  source file for `Buffer`, `node:`/bare-builtin imports, `require`, `Math.random`, and wall-clock/timer
  globals. The shipped artifact is built under `tsconfig.build.json` with `types: []`. The only Node-specific
  file will be the future CLI (`src/cli/`), excluded from both the guard and the neutral build.
- **Determinism rule (load-bearing).** No `Math.random`. No behaviour may depend on unordered-key iteration
  (`Object.keys` / `Map` / `Set` traversal order deciding a result): iterate arrays in a defined order, or
  sort first. **Same seed ⇒ byte-identical network.**

## PRNG

TallySim reuses `tallynet`'s seeded PRNG — `SeededRandom` (mulberry32), from the `tallynet/testing` subpath
export — and does **not** inline its own. One seed therefore replays graph generation *and*, in later tiers,
the protocol's own randomness: the whole run is reproducible from a single seed. `SeededRandom` offers
`nextFloat()`, `nextInt(maxExclusive)` and `randomBytes(n)`. It is not cryptographically strong — simulation
and tests only.

## Model

The model is plain, JSON-serialisable data (`src/model.ts`), so a scenario can be saved, shared and
replayed. **Entities are nodes; tallies are edges.** Entities are index-based — an entity is just an integer
id in `0 .. entityCount - 1` (`EntityId`); no per-entity payload is needed at this tier.

```ts
interface Tally {
	stock: number            // entity id of the stock holder (conventionally the creditor side)
	foil: number             // entity id of the foil holder (conventionally the debtor side)
	balance: number          // b: units the foil currently owes the stock (signed)
	stockCreditLimit: number // L_stock: upper bound on b (Infinity = unbounded)
	foilCreditLimit: number  // L_foil: lower bound b >= -L_foil (Infinity = unbounded)
}

interface Network {
	entityCount: number
	tallies: Tally[]
	meta: { generator: string; params: Record<string, number>; seed: number; formatVersion: number }
}
```

Multiple tallies between the same pair are allowed (two tallies are two edges). Generators produce no
self-loops (`stock !== foil`).

**Serialisation and the `Infinity` sentinel.** A credit limit of `Infinity` means *unbounded* (the
"unlimited capacity" variant). `JSON.stringify` turns `Infinity` into `null`, so `serialize` / `deserialize`
map `Infinity` ↔ the JSON value `null` on the two credit-limit fields. A saved scenario round-trips exactly,
including unlimited limits and an empty network. `serialize` writes fields in a fixed order (deterministic
output); `deserialize` checks `meta.formatVersion` and rejects a version it does not understand.

## Capacity model

A lift (or payment) moves value across a tally in one direction; how much it can move before hitting a
credit bound is that tally's **directed capacity** (`src/capacity.ts`). The balance `b` is measured from the
foil's obligation — the units the foil owes the stock — so `b ∈ [-foilCreditLimit, +stockCreditLimit]`.
"Value flows X → Y" means Y ends up better off (X takes on the obligation). Then, per tally between stock `S`
and foil `F`:

```
cap(F → S) = stockCreditLimit - b     // value flows foil→stock: b rises toward +stockCreditLimit
cap(S → F) = b + foilCreditLimit      // value flows stock→foil: b falls toward -foilCreditLimit
```

Both are non-negative, and `cap(F→S) + cap(S→F) = stockCreditLimit + foilCreditLimit` — the **total swing**,
independent of `b` (the balance only sets the *split*). A zero-capacity direction (`b` at a bound) is a
valid, expected state. An `Infinity` credit limit yields an `Infinity` capacity in that direction.

**Scope — what this omits (decided here).** This is the MyCHIPs lift-capacity idea reduced to what the
**oracle** needs: raw credit-limit room, answering *does capacity exist*. It deliberately **omits the
trading-variable fee structure** — `target` / `bound` / `reward` / `clutch`, the `LiftLading` view in
[`docs/architecture.md`](../../../docs/architecture.md) and [`docs/trading-variables.md`](../../../docs/trading-variables.md).
Those bound a lift's *cost* and which routes an agent *prefers*, not whether a route physically *exists*.
Fees — and the balance dynamics that consume capacity over time — belong to the protocol tier and the
trading-model work (`feat-tallysim-trading-model` in the backlog), not the oracle.

### Capacity / balance distributions

A generator assigns each tally its orientation (which endpoint is stock vs foil) and its
`(stockCreditLimit, foilCreditLimit, balance)` from a **parameterised distribution** chosen per run
(`src/distributions.ts`). Limits are produced as **non-negative integers** (so directed capacities stay
integers), except `unlimited`. **Balance defaults to 0** everywhere (a tally starts square).

| Distribution | Parameters | Limits | Balance |
|---|---|---|---|
| `unlimited` | — | both `Infinity` | 0 |
| `constant` | `limit`, optional `balance` | both `limit` | 0 (or the given `balance`) |
| `uniform` | `min`, `max`, optional `randomizeBalance` | each drawn uniformly in `[min, max]` | 0, or uniform in `[-foilCreditLimit, +stockCreditLimit]` |
| `lognormal` | `mu`, `sigma`, optional `randomizeBalance` | each `round(exp(mu + sigma·Z))`, `Z` standard normal (Box–Muller), clamped `>= 0` | 0, or uniform in `[-foilCreditLimit, +stockCreditLimit]` |

The number of `rng` draws depends only on the distribution kind (and `randomizeBalance`), so the stream
stays reproducible.

## Generators

Four seeded generators (`src/generators/`), each `(params, rng?) => Network`. `rng` defaults to a fresh
`SeededRandom` seeded from `params.seed`, so **same seed ⇒ byte-identical network**; a shared `rng` can be
injected to interleave generation with other seeded draws. Each records a stable `meta.generator` id and its
numeric structural params in `meta.params`.

**Orientation rule (shared).** For each edge a coin is drawn from `rng`: heads (`< 0.5`) makes the first
endpoint the stock and the second the foil; tails swaps them. Topology is built first (the set of unordered
pairs), then each pair in array order is oriented and given a capacity draw — keeping structural logic
separate from the capacity distribution.

| Generator | id | Parameters | Shape |
|---|---|---|---|
| `uniform` | `uniform` | `meanDegree` (`k`) | Erdős–Rényi style: `m = round(n·k/2)` edges between random distinct pairs; parallel edges allowed. Poisson-ish degree. |
| `scaleFree` | `scale-free` | `edgesPerNode` (`m`) | Barabási–Albert preferential attachment: each new entity brings `m` edges to existing entities chosen proportional to degree. Heavy-tailed; a few hubs. |
| `clustered` | `clustered` | `communityCount` (`c`), `meanIntraDegree`, `bridgeCount` | Contiguous communities, dense within (ER to `meanIntraDegree`), with **exactly** `bridgeCount` inter-community edges. |
| `smallWorld` | `small-world` | `neighbors` (`k`, even), `rewireProbability` (`β`) | Watts–Strogatz: ring lattice of `k` nearest neighbours, each edge rewired with probability `β`. Rewiring preserves edge count (mean degree stays `k`). |

**Determinism guarantee.** Every generator draws only from the injected `SeededRandom` and iterates arrays
in a defined order; no result depends on unordered-key iteration. The same `(params, seed)` always produce
the same `Network`, verified by tests.

**Edge / degenerate behaviour.**
- `uniform`: `meanDegree = 0` ⇒ no edges; `entityCount = 1` ⇒ no edges (no self-loop possible).
- `scaleFree`: `entityCount <= edgesPerNode` ⇒ a complete graph among the entities (too few to seed
  attachment).
- `clustered`: a single community (`c = 1`) ⇒ all intra edges, no bridges; bridges need two non-empty
  communities; communities of size < 2 host no intra edges.
- `smallWorld`: `β = 0` ⇒ the pure ring lattice; `β = 1` ⇒ every edge rewired where a free target exists;
  `k = 0` ⇒ no edges. `k` must be even and `< entityCount`.

## Structural utilities

Pure graph utilities over a `Network` as an **undirected multigraph** (`src/structure.ts`), used for
generator-fidelity tests and reused later by the runner's metrics:

- **degree** — `degreeSequence` (per entity), `meanDegree` (`2·edges/entities`), `degreeHistogram` (a sorted
  `[degree, count]` array).
- **connected components** — `connectedComponents` via union-find over the undirected edges: component id per
  entity, component count, largest size, and the **largest-component fraction** (`largestSize / entityCount`).
  Isolated entities are their own singleton components, so an all-isolated network of `n` entities reports
  fraction `1/n`; a fully connected one reports `1`.

All iterate deterministically (entity index, then tally-array order).

---

## Oracle

The **oracle** (`src/oracle.ts`) sees the *whole* graph and searches it directly: it is the **ground
truth** the later discovery tier measures the real `tallynet` routing protocol against ("found vs.
oracle"). Keeping it independent of the protocol is the point — when a lift fails, the oracle says whether
the *network* could ever have carried it, separate from whether the *protocol* found it.

### Compiled graph view

The serialisable `Network` is convenient to build and store but slow to search, so the oracle compiles it
once (`src/graph-view.ts`, `buildGraphView`) into a **directed capacity graph** in CSR (compressed-sparse-
row) form:

- Each tally becomes **two directed capacity edges** — `stock→foil` with capacity `cap(S→F)` and
  `foil→stock` with capacity `cap(F→S)` (§ Capacity model). A graph view thus has exactly
  `2 · tallies.length` directed edges; parallel tallies become parallel directed edges.
- Stored as three **typed arrays**: `offsets` (`Int32Array`, length `entityCount + 1` — node `u`'s
  out-edges are the slice `[offsets[u], offsets[u+1])`), `targets` (`Int32Array`), and `capacities`
  (`Float64Array`, so an unlimited credit limit's `Infinity` is representable directly).
- **Deterministic build**: edges are emitted in tally order, and within a source's slice the neighbours
  appear in incident-tally order. Same network ⇒ byte-identical arrays; no result depends on unordered-key
  iteration.

An `Oracle` wraps one graph view and **reuses scratch buffers** across queries — a generation-stamped
`visited` array is cleared in O(1) by bumping a counter rather than re-zeroing O(n) per query — so a sweep
of ~1,000 route-existence queries over a 10,000-entity graph runs in **seconds, not minutes** (the parent
plan's performance target; guarded by a smoke test).

### Queries

Each algorithm is a small, separately-tested method:

- **Route existence + shortest length** (`routeExistence(from, to, amount, maxDepth)`) — **bounded
  breadth-first search (BFS)** from `from` over only the directed edges with `capacity ≥ amount`, stopping
  at `maxDepth`. Returns `{ exists, shortestLength }`, where `shortestLength` is the BFS level at which `to`
  is first reached (BFS gives the shortest hop count for free). `maxDepth` **counts hops**: a 1-hop path is
  length 1, and a `to` reachable only at `maxDepth + 1` reports `exists: false`.
- **Self-payment / circular clearing** (`selfPayment(node, amount, maxDepth)`, and
  `routeExistence(X, X, …)` which delegates to it) — a payment to oneself is a **cycle**, not a zero-length
  path. Shortest directed cycle through `node` with every edge `capacity ≥ amount`, bounded by `maxDepth`.
  Computed as a bounded BFS: the shortest cycle length is `min over u of (dist(node, u) + 1)` across nodes
  `u` with a qualifying edge back to `node`; BFS processes nodes in increasing distance, so the first edge
  back is the shortest. The shortest possible cycle is length 2 (`node → v → node`); length 0 is never
  reported.
- **Max-flow** (`maxFlow(from, to)`) — maximum value payable, not just whether one unit is, via
  **Edmonds–Karp** (BFS-augmenting-path Ford–Fulkerson) on the directed capacity graph. Parallel edges
  add. Returns `Infinity` when an all-unlimited augmenting path exists. This is the **"ignoring depth, how
  much could flow"** figure, complementary to the depth-aware route-existence query.
- **Clearing-cycle availability** (`clearingCycles(node, amount, maxDepth, maxCount)`) — how many directed
  cycles with spare capacity (every edge `capacity ≥ amount`) pass through `node` up to `maxDepth`, via a
  bounded DFS seeking a return to the start. The count is **capped** at `maxCount` (`capped` reports
  whether the cap was hit), because cycle counts explode. Also returns the shortest qualifying cycle's
  length. Cycles are **directed** (the two ways round a loop are two distinct cycles) and counted by
  distinct edge-sequence, so parallel tallies yield distinct cycles.

### Depth-bounded vs. unbounded

Route existence and the clearing queries are **depth-bounded** (`maxDepth` hops) — a real lift crosses a
bounded number of tallies. Max-flow is **not depth-bounded**: depth-bounded max-flow is a different, harder
problem (out of scope). The two are complementary — route existence answers "within `D` hops, can *a* unit
get through", max-flow answers "ignoring depth, *how much* could flow".

### Amounts

All amounts/capacities compare as the model's integers (stored in `Float64Array`). A non-positive `amount`
is **rejected** (throws) rather than treated as "any edge qualifies" — asking whether a payment of ≤ 0
routes is a programming error. With `amount > 0` the `capacity ≥ amount` filter prunes zero-capacity
directions automatically (an edge with `capacity === amount` qualifies; `capacity === amount − 1` does
not). `maxFlow(X, X)` has no distinct sink and returns 0 (self-clearing is `clearingCycles`, not an s–t
max-flow).

### Cost guidance for the runner

- **Max-flow is `O(V·E²)`** — far costlier than BFS. On a 10k-node sweep the runner tier must compute
  max-flow on a **sampled subset** of query pairs (or only on request), never on every query. Route
  existence/shortest-path (BFS) is cheap at this scale and can run on every query.
- **Clearing-cycle enumeration** can explode, hence the `maxCount` cap; the runner picks a cap that bounds
  per-node work.

### Tripwires

- **Capacities beyond 2^53.** Capacities are `number` (`Float64Array`), so a simulated capacity above 2^53
  would lose integer precision. Fine for all planned scenarios (simulated units stay small). *If* a
  scenario ever needs larger capacities, switch the capacity store to `BigInt64Array` and the oracle
  arithmetic to `bigint`. (Recorded at the `capacities` allocation in `graph-view.ts`.)
- **Max-flow cost.** As above — `O(V·E²)` means the runner must sample, not run max-flow per query on large
  graphs. (Recorded on `Oracle.maxFlow` in `oracle.ts`.)

### Verification

The oracle's correctness rests on an **independent exhaustive enumeration** on small graphs
(`src/oracle-brute-force.test.ts`): every simple path / cycle up to `maxDepth` enumerated directly, and
max-flow checked against a **min-cut subset enumeration** (a genuinely different computation, via the
max-flow/min-cut theorem). Existence, shortest length, cycle counts and capacity/depth respect are all
cross-checked against seeded random small graphs.

## Metrics

*To come — `tallysim-runner`.* Oracle-level metrics the runner will aggregate over a workload, all derived
from the queries above: **P(route exists)** (fraction of payment queries with a route),
**path-length distribution** (over `shortestLength` of successful queries), **max-flow distribution** (over
sampled pairs), **largest-connected-component fraction** (reusing `src/structure.ts`), and
**clearing-cycle availability** (fraction of sampled nodes with ≥ 1 usable cycle, and the cycle-length
distribution).

## Runner / experiments

*To come — `tallysim-runner`.* The sweep runner, CLI, output serialisers, the "step the economy" seam, and
the first checked-in experiment.

## Trace & replay format

*To come — `tallysim-discovery`.*
