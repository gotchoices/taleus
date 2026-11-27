# TallySim design

TallySim is the Taleus **tally-network simulator**. It exists to answer Taleus's central research
question in two independent halves:

1. **Network shape** — *how connected must a tally network be before a payment can usually find a route
   through it?* This is measured by an **oracle** that sees the whole network and searches it directly.
2. **Protocol behaviour** — *does the real, decentralised routing protocol (`tallynet`) find the routes the
   oracle proves exist?* This is measured by replaying the protocol on the same networks (later tiers).

The two are kept deliberately apart (see [Tiers](#tiers)). This document is the canonical design; it grows
one tier at a time. This file currently covers the **network-model tier** (the data model, the capacity
model, the generators, and the structural utilities), the **oracle**, the **runner / experiments** tier
(the scenario/sweep model, the sweep runner, the metrics, the output serialisers, the CLI, and the first
checked-in experiment), and the **discovery-simulation** tier (the wiring that runs the real `tallynet`
protocol over a simulated network and runs one payment query to completion). It also covers the **discovery
and consensus metrics**, their sweep runners and CLIs, and the **trace & replay format**. The
**consensus-simulation** tier builds on discovery: it drives a found route through the real sign-and-settle
lift, records whether the lift commits / voids / stalls (and why), and moves money on commit.

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
| **Runner / experiments** | Sweep a parameter over many generated networks, run the oracle per query, record metrics, check in findings. | built |
| **Discovery / consensus** | Replay the real `tallynet` protocol on the same graphs: discover a route, drive it through sign-and-settle, move money on commit, and compare "found vs. oracle". | built (discovery + consensus drive/settle) |

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

Metric aggregation is a **pure module** (`src/metrics.ts`): raw per-query results in, a run summary out — no
network, no oracle, no filesystem, so it is testable with hand-built inputs and the browser viewer reuses it
unchanged. The runner runs the oracle to produce the raw results, then calls one summariser per workload
kind. A scalar `DistributionSummary` (`count`, `mean`, `min`, `max`, `p50`, `p90`, `p99`, by linear-
interpolated quantile over the sorted samples) condenses each distribution.

Every run carries two **structural** metrics (one value per network, independent of the workload): the
network's actual `meanDegree` (`2 · edges / entities` — the headline x-axis, so a combined data file is
comparable across generators that parameterise degree differently) and its `largestComponentFraction`
(reusing `src/structure.ts`). A `payment` workload adds:

- **P(route exists)** (`pRouteExists`) — fraction of payment queries with a route within the depth bound;
  the headline metric, plus the raw `routeExistsCount`.
- **path-length distribution** (`pathLength`) — a `DistributionSummary` of `shortestLength` over the
  **successful** queries.
- **max-flow distribution** (`maxFlow`) — a `DistributionSummary` over the sampled pairs; present only when
  max-flow was opted into (see the runner).

A `clearing` workload adds `sampledNodeCount`, `clearingAvailability` (fraction of sampled nodes with ≥ 1
usable cycle), and a `clearingCycleLength` distribution over the nodes that have one.

**Degenerate inputs are guarded, not special-cased by the caller.** A fraction over zero trials is **0, never
`NaN`**; a distribution over zero samples reports `count: 0` with zeroed scalars rather than throwing. The
caller distinguishes "no data" by that `count`, never by a `NaN`.

## Runner / experiments

The runner turns a sweep description into a stream of per-run records; the CLI writes those records to files;
a first experiment uses the whole pipeline to answer the tier's headline question.

### Scenario and sweep model

Two plain, JSON-serialisable shapes (`src/scenario.ts`) describe an experiment, so a run can be saved,
shared and replayed:

- A **`ScenarioSpec`** is one network plus one workload. Its `network` (`NetworkSource`) is **either** a
  generator recipe — `{ generator, params, capacity, seed }` — **or** an already-materialised `Network`
  (`{ materialized }`); both are valid inputs and the runner materialises the former. The generator variant
  carries its `CapacityDistribution` explicitly (the generators need it, and it is not a plain number, so it
  cannot live in the numeric `params` map). The `workload` (`WorkloadSpec`) is a batch of random queries of
  one `kind` (`payment` or `clearing`), how many (`queries`), an `amount` distribution (`constant` or
  `uniform`), a depth bound (`depth`), a workload PRNG `seed`, and an optional opt-in `metrics` list.
- A **`SweepSpec`** is a `base` scenario, a list of `vary` dimensions (`{ path, values }`, each a dotted path
  into the base and the values to step it through), and a list of `seeds` to repeat every cell over. The
  runner takes the **cartesian product** of all `vary` dimensions — one record per `(valueA, valueB, …, seed)`
  cell. One or two dimensions is the readable norm (and what a plot wants); the runner imposes no arity cap,
  and the checked-in route-existence experiment uses three (degree, entity count, depth).

### Seeds — three independent reproducible streams

Each run derives **three** separate `SeededRandom` streams, every one offset by the run seed (one of
`spec.seeds`): the **network** seed (graph generation), the **workload** seed (query pairs + amounts), and
the **economy** seed (the trading seam, below). The network and workload seeds are independent (distinct base
seeds, distinct derived streams), so a cell repeated at a different run seed draws a genuinely different
network *and* workload, yet the whole sweep replays byte-for-byte from the spec. The determinism rule from
the model tier (no `Math.random`, no result depending on unordered-key iteration) holds end to end: **a sweep
run twice produces byte-identical output.**

### Records and the sweep run

`runSweep(spec)` is a **generator** that touches no filesystem: it yields one `RunRecord` per cell × seed and
retains none, so a large sweep streams without buffering. A `RunRecord` is `{ generator, capacity, params,
seed, metrics }` — the generator id and capacity-distribution kind (so a combined file is self-describing),
the resolved sweep coordinates (`params`, keyed by each `vary` path), the run seed, and the aggregated
`RunMetrics`. `runSweepToArray` collects a whole sweep for small cases and tests. The browser viewer drives
the same `runSweep` live in a page; only the CLI adds file I/O.

**Max-flow is opt-in per run** — a workload must list `'max-flow'` in `metrics`, because Edmonds–Karp is
`O(V·E²)` and far costlier than the BFS route-existence query. When enabled the runner samples a bounded
subset of the drawn query pairs (`maxFlowSamples`, default 32) rather than running it on every query. Default
is off.

### Output serialisation and the CLI

**Pure, platform-neutral** serialisers: a record → one **JSON-lines** string (the full nested record), and a
set of records → a **CSV summary** (one row per run; columns = `generator`, `capacity`, the varied param paths,
`seed`, then the scalar metrics, each `DistributionSummary` expanded to `count/mean/min/max/p50/p90/p99`
columns, each nested numeric object — e.g. the discovery sweep's `pruneReasons` — to `object.key` columns).
Non-finite numbers (an unbounded max-flow is `Infinity`) serialise as JSON `null` / an empty CSV cell, matching
the model's `Infinity ↔ null` convention; finite records round-trip through JSON-lines exactly. A streaming
`CsvAccumulator` lets the CLI build the CSV on the **same pass** it writes JSON-lines, keeping only lightweight
per-row scalars rather than the full record set.

Both run-record kinds share one provenance shape (`generator`, `capacity`, `params`, `seed`, `metrics`) and
differ only in the `metrics` payload, so the machinery is **generic over the metrics shape** in
`serialize-records.ts` (`metricsRecordToJsonLine`, `createSweepCsvAccumulator(metricColumns)`, …). The oracle
serialiser keeps its `RunRecord`-typed functions (`recordToJsonLine`, `createCsvAccumulator`, …) as thin
wrappers that pin the oracle's canonical column order — so their byte output is unchanged — and
`serialize-sim-records.ts` adds the discovery-sweep counterpart (`simRecordToJsonLine`,
`createSimCsvAccumulator`, …) with its own column order (the found-vs-oracle fields, the six cost/timing
distributions, then the six prune-reason tallies). `serialize-consensus-records.ts` adds the **consensus-sweep**
counterpart (`consensusRecordToJsonLine`, `createConsensusCsvAccumulator`, …) the same way — reusing the generic
machinery, supplying only its column order (`pCommitGivenFound` and the commit/void/pending counts, the
`timeToSettleMs` / `messagesPerLift` distributions, the four `voidReasons.<reason>` tallies, then the
completion scalars `cooperatingMemberTotal` / `cooperatingCommittedTotal` / `cooperatingCompletion` /
`recoveredTotal`, the `pullMessagesPerLift` distribution, the plan-refusal scalars, and finally the
`creditHeldMsPerLift` distribution and the `permanentlyPendingCount` / `permanentlyPendingFraction` scalars).

The **CLIs** (`src/cli/`) are the **only Node-specific files** in the package — they do file I/O, so they live
outside the neutral core, are excluded from the `no-node-globals` guard and the neutral `tsconfig.build.json`,
and are compiled with node types by `tsconfig.cli.json`. `cli/sweep.ts` drives the oracle sweep; `cli/simulate.ts`
drives the discovery sweep (iterating the **`async`** `runSimSweep` with `for await`); `cli/consensus.ts` drives
the consensus sweep (iterating `runConsensusSweep`). Each reads its spec JSON file, **streams** the JSON-lines
records to stdout (or `--jsonl <path>`) as each is produced, and writes the CSV summary to `--csv <path>`:

```
yarn workspace tallysim sweep <spec.json> [--jsonl <out.jsonl>] [--csv <out.csv>]
yarn workspace tallysim simulate <spec.json> [--jsonl <out.jsonl>] [--csv <out.csv>] [--concurrent] \
    [--trace <trace.ndjson> [--query <i> ...] [--seed <n>]]
yarn workspace tallysim consensus <spec.json> [--jsonl <out.jsonl>] [--csv <out.csv>]
```

`consensus` deliberately carries **no** `--concurrent` (the consensus sweep is sequential-only — see § *The
sequential consensus sweep runner*) and **no** `--trace` (the consensus trace is a separate tier). `simulate`'s
`--concurrent` sets `SimRunnerDeps.concurrent`. Its optional `--trace` dumps one full, replayable
trace — of the sweep's **unvaried base scenario** (`spec.base`, with `vary` NOT applied) at the `--seed` run
seed (default 0), for the selected `--query` indices (default all) — by reusing `cli/trace.ts`'s `recordTrace`,
so that trace is byte-identical to what `cli/trace.js` would write for the same scenario + seed. It is **not** a
trace of a swept cell; use `cli/trace.js` on a materialised cell scenario for that.

### The "step the economy" seam

A real tally network is not static: entities trade, so credit capacity is consumed in one direction and
restored (especially by circular lifts) over time. This tier does **not** model that — every tally starts
square (balance 0) and nothing moves it. The hook is the `EconomyStep { step(network, rng) }` interface; each
run calls it once, before the graph view is built, on the run's own (economy) `SeededRandom`. The shipped
default is `noOpEconomyStep` (does nothing). A real implementation — producers/consumers trading, circular
lifts restoring capacity — is the backlog item **`feat-tallysim-trading-model`**. (A trading model that
*mutates* a `materialized` network must clone it per run; the no-op default never mutates, so the runner
returns a materialised input by reference today — see the `NOTE` in `runner.ts`.)

### First experiment — route existence vs. connectivity

`experiments/route-existence/` is the tier's first checked-in result. It asks the headline question —
**how connected must a tally network be before a payment usually finds a route?** — by sweeping four committed
specs (`specs/*.json`): the `uniform` (Erdős–Rényi) and `scale-free` (Barabási–Albert) generators, each with
**unlimited** capacity and then a **realistic** capacity (`lognormal`, `mu=3`, `sigma=1`, randomised balances
— median credit limit ≈ 20 units). All four hold the payment amount at a constant 10, so the *only* difference
between the unlimited and realistic runs is capacity. Each sweep varies the degree parameter × entity count
`N ∈ {100, 1000, 10000}` × depth bound `D ∈ {4, 6, 8}`, over seeds `[1, 2, 3]` (≈ 100 queries per run). The
whole grid runs in a few seconds (route existence is a cheap BFS), so the seed count is modest only by choice,
not necessity. `regenerate.sh` rebuilds and reproduces the committed `out/*.{jsonl,csv}` and the combined
`route-existence.jsonl` **byte-identically**.

**What the data shows.** There are *two distinct thresholds*, and the headline metric tracks the second, not
the first:

1. **A giant connected component appears at mean degree ≈ 1** — the classic percolation threshold. In the
   `uniform` data the `largestComponentFraction` jumps from ~0 below degree 1 (0.05 at degree 1) to ~0.57 at
   1.5, ~0.80 at 2, ~0.94 at 3. So *structural* connectivity turns up right where theory predicts.
2. **Depth-bounded route existence turns up much later, along `degree^D ≈ N`.** Being in one component is not
   enough: within `D` hops a BFS reaches only ≈ `degree^D` nodes, so a route to a *random* target exists with
   useful probability only once `degree^D ≳ N`, i.e. `degree ≳ N^{1/D}`. The data fits this closely — e.g. at
   `N = 10000`: `D = 4` needs degree ≈ 10 (at degree 6, `6^4 ≈ 1300`, so `P ≈ 0.15`), `D = 6` crosses near
   degree 4–6 (`P` = 0.34 → 0.93), `D = 8` crosses near degree 3–4 (`P` = 0.47 → 0.92). Smaller `N` and larger
   `D` both pull the turn-up to lower degree, exactly as `N^{1/D}` says.
3. **Realistic capacity shifts the route-existence curve up (needs more degree / more depth).** With randomised
   balances, each tally's spare capacity in a given direction is roughly uniform over its swing, so a payment
   of 10 clears a single hop only ~¾ of the time; a `D`-hop path needs *every* hop to clear, shrinking the
   effective reachable set by ≈ `(¾)^D`. At matched `(N, D, degree)` the realistic `P` is consistently below
   unlimited — e.g. `uniform, N = 10000, D = 6, degree = 6`: `0.93` unlimited → `0.52` realistic; `N = 1000,
   D = 8, degree = 3`: `0.86 → 0.46`. The structural (`largestComponentFraction`) threshold is unchanged —
   capacity gates *flow*, not *topology*.
4. **Scale-free routes far more readily than uniform at the same mean degree.** Its networks are always a
   single component (`largestComponentFraction` = 1 everywhere — every new entity attaches to the existing
   graph), so the giant-component threshold is irrelevant; the binding constraint is depth. Hubs keep paths
   short — mean successful path length ≈ 4 hops even at `N = 10000` for `edgesPerNode = 4` (mean degree ≈ 8),
   vs ≈ 5.4 hops for `uniform` at mean degree 6 — so `scale-free, N = 10000, D = 6, degree ≈ 4` already routes
   at `P = 0.96` where the matched `uniform` cell sits at `P = 0.34`. Realistic capacity shifts it down too,
   but less severely, because the short hub paths cross fewer capacity gates.

The headline for Taleus: **mean degree ~1 buys a connected graph, but usable payment routing needs both
enough degree and enough hop budget that `degree^D ≳ N`, and real (finite, partly-consumed) capacity raises
the bar further** — hub-heavy ("scale-free") topologies clear that bar at much lower average connectivity
than uniform random ones.

## Discovery simulation

The oracle tier answers *does a route exist* with a god's-eye view of the whole graph. The **discovery
simulation** tier (`src/sim/`) answers a harder question: does the real decentralised route-discovery
protocol (`tallynet`), where each node sees only its own tallies, *find* the routes the oracle proves
exist? It runs the actual `tallynet` protocol over a simulated tally network on compressed, deterministic
time, so a payment search behaves as it would on a live network — honouring each node's local-only view of
capacity, plus latency, dropped messages and sleeping nodes — and the experiment measures the gap between
what the network *could* carry and what the protocol *found*.

The discrete-event machinery is **not** rebuilt here. `tallynet/testing` ships the `VirtualClock` (a
min-heap of timers; time advances only when a timer fires) and `InMemoryNetwork` (one discovery node per
graph node, wired over that clock, with per-link `latencyMs`/`drop` conditions and a shared seeded
random). This tier consumes them; everything simulator-specific lives in `tallysim`.

### Node ↔ entity naming

`tallynet` keys nodes by string name; tallysim entities are integers `0 .. entityCount − 1`. `sim/naming.ts`
holds the single bijection — `entityName(id) = String(id)`, `entityId = Number` — and `linkIdForTally(i) =
"T" + i`, shared by the harness (building the graph) and the conditions compiler (keying per-link
conditions) so the two agree on a link's identity without sharing state. Trace events and metrics map a
node name back to an entity id through `entityId`.

### Capacity equality with the oracle (the correctness anchor)

Each tally becomes one discovery link with `node1 = entityName(stock)`, `node2 = entityName(foil)`,
carrying one `'L'` intent whose terms are `{ capFwd: capStockToFoil(t), capBack: capFoilToStock(t),
amount: 0 }` — computed from the **same** `capacity.ts` helpers the oracle's graph view uses.
`InMemoryNetwork` produces the reverse (`node2 → node1`) view via `invertLiftTerms` (swap the two directed
capacities). So a node `u`'s forward view of a link to neighbour `v` has `capFwd = cap(u→v)`, identical to
the oracle's directed edge `u→v`. The node policy (`sim/terms.ts`, `makeCapacityHooks`) overrides only the
two capacity checks of `tallynet`'s default hooks: `negotiateIntent` forwards a candidate only when
`capFwd ≥ amount` (so a node forwards over only its own tallies that can carry the amount — a real node
acting on its local view, which also keeps the message count honest), and `planSatisfies` re-checks every
hop (and rejects an empty path — a payment's originator is never the payee here). The required amount
**rides on the query**, never a closure, so one reused network serves many queries at different amounts.

Because every protocol hop maps onto an oracle directed edge with identical capacity, **every route the
protocol returns is one the oracle confirms** — `found ⊆ oracle` at matched depth. `Infinity` capacity
(unlimited credit) compares and inverts correctly and is never serialised here, so CBOR's `Infinity`
rejection does not apply.

### Rounds ↔ hops: one round per level, `maxDepth = L`

The oracle's `maxDepth` counts hops (a 1-hop path is length 1), and so does the protocol's: a route of
**L** hops is found at exactly `maxDepth = L` — one round per level — and missed at `maxDepth = L − 1`.
The two use the same hop count, so **no depth doubling is needed**: the harness passes `discover maxDepth
= query.depth` and compares the oracle at the *same* depth, and that comparison is now apples-to-apples.
Every target in this tier surfaces as a *peer-match terminus* (a neighbour resolves the target from its
own adjacency rather than the search entering it as a relay), which resolves the final hop in the same
round and so costs no extra round — an L-hop plan has `path.length = L ≤ maxDepth = L`.

> An earlier version of this section claimed reach was `⌊maxDepth/2⌋ + 1` — "~half the ceiling",
> `maxDepth ≥ 2(L − 1)` — and told depth sweeps to "budget roughly double the hop distance". That
> doubling was **not** a protocol property: it was an artifact of the `tallynet/testing` `VirtualClock`
> under-draining discovery's per-level completion cascade, which folded instant answers one round late.
> The clock now drains a full macrotask between fires — flushing a cascade of any length in one hop — so
> the systematic 2× undercount is gone. See the drain docs atop `tallynet`'s `src/testing/clock.ts` and
> `docs/design.md` § Protocol design.

The robust, always-true guarantee remains **`found ⊆ oracle`** (every found `path.length ≤ depth`, every
hop `capFwd ≥ amount`), **never `found iff oracle`**: the protocol is a greedy, distributed search, so it
can still miss routes the whole-graph oracle sees. But that remaining found-vs-oracle gap is now **real
protocol loss** (greedy pruning, degrading conditions) — the thing the degradation experiment is meant to
measure — not a fixed simulator-clock undercount layered on top of it.

### Network conditions

The degrading conditions are the whole point of the experiment, so the **oracle always runs on the full,
undegraded network**; only the protocol run is degraded. `sim/conditions.ts` compiles a declarative
`ConditionsSpec` into the harness's static per-link `conditions` map plus a sleeping-node set, drawing every
choice from a **dedicated** `SeededRandom` stream (a conditions seed, independent of the
network/workload/economy seeds). It must be precomputed from its own stream because the harness's shared
random mints session codes: drawing conditions from it would make session codes shift whenever a condition
changed and break determinism. (Outcomes never depend on session-code *values*, only nonces do, so the
harness seeds that shared stream from a fixed module constant.)

Selection is **count-based**, not Bernoulli: each fraction picks exactly `round(fraction · poolSize)`
members via a seeded partial Fisher–Yates shuffle, so a test can assert a precise count. Mapping to the
per-link surface:

- **Sleeping node** (never answers): both incident links `drop`. A sleeping delivery never resolves (no
  timer armed), so the sender's budget skips it each round and it is pruned at the depth ceiling. Note that
  a sleeping *target* does **not** block a route — a neighbour resolves the peer-match from its own
  adjacency without delivering to the target; only a sleeping non-target **relay** blocks.
- **Late node**: both incident links carry `lateLatencyMs`, chosen to exceed a round budget; the
  participant folds the late answer into a later round rather than losing it.
- **Dropped links**: a `dropFraction` of the links *not* incident to a sleeping/late node `drop`.
- **Base latency**: every remaining link draws `latencyMs` from the `latency` distribution (omitted ⇒
  instant).
- **Precedence** (per link): sleeping (drop) > late (lateLatencyMs) > dropFraction (drop) > base latency.

Sleeping and late are an **undirected approximation** (both incident links carry the condition) — the
correct "this node contributes nothing / answers late" model for a per-link condition surface, which cannot
distinguish a tally's two directions and does not need to for this tier.

### Running one query

`buildSimNetwork(network, conditions, conditionsSeed, trace?, options?, consensus?)` materialises the
discovery graph, compiles the conditions, and wires an `InMemoryNetwork` over a fresh `VirtualClock`.
`runQuery(sim, { from, to, amount, depth })` issues `discover`, drives `clock.runUntilIdle()` to settle it,
and returns `{ sessionCode, plans, found }`. It never throws for "not found" (empty plans), for `from ===
to`, or for a network with fewer than two entities. One `InMemoryNetwork` serves every query in a run (no
balances move in this tier; per-session state lives in per-node stores, so queries do not interfere).

The optional `consensus?: { identitySeed, resourceFor? }` turns on the atomic promise/commit engine: each
graph node gets a deterministic ed25519 identity (`sim/identity.ts` — `(identitySeed, name)` ⇒ a
reproducible key from its own seed stream, never a shared RNG) and, optionally, a failure-injecting resource
port (`sim/consensus-resource.ts` — `makeSimResources`, keyed by **entity id**, adapted to the harness's
node-name key at the boundary). Omitting `consensus` leaves the discovery-only wiring byte-for-byte
unchanged, so the pinned discovery sweeps pay no keygen. This is Phase-1 mechanism only — nothing drives an
end-to-end payment lift yet (that is `tallysim-consensus-drive-settle`).

Scope: **payment route discovery only** this tier (the v1 protocol is unidirectional payment search).
Clearing-availability discovery is deferred (backlog `feat-tallysim-clearing-discovery`); multi-denomination
negotiation is later work, so `annotateReturn` / `negotiatePlan` stay identity.

### Protocol metrics

`sim/protocol-metrics.ts` is the measurement layer — **recorded run in, metrics out** — pure like the oracle
tier's `metrics.ts` (no network / oracle / clock / filesystem), so it is testable from hand-built trace
events and reusable in a browser viewer. `analyzeQuery(events, outcome, routeExists, { startMs, endMs })`
reduces **one** query to a `ProtocolQueryResult`. It filters `events` by `outcome.sessionCode` internally, so
it works on one session's events or a whole concurrent batch's. From that session's events it derives:
`messages` = count of `query-sent` (sub-requests issued, **not** deliveries — a folded late answer adds
none); `nodesTouched` = distinct emitting node ids; `roundsUsed` = max round over `round-started` + `query-sent`
(0 if none); `timeToFirstPlanMs` = first `plan-found` time − start (omitted if none); `timeToCompletionMs` =
last-event time (or `endMs` for a session with no events) − start; and `pruneReasons`, a per-reason count over
`candidate-pruned`, zero-initialised for all six `PruneReason`s. (`zeroPruneReasons()` is the compile-checked
source of truth for that reason set; `ALL_PRUNE_REASONS` derives from it, so the mirror of tallynet's
type-only union cannot silently drift.)

`summarizeProtocolMetrics(results, structural)` aggregates a run into `ProtocolRunMetrics`. The headline is
**`pFoundGivenExists`** = `foundAndExistsCount / routeExistsCount` — P(found | a route exists), the
complement of the oracle tier's P(route exists), and **0 (never NaN)** when no route exists. `falseFoundCount`
(found by the protocol but no oracle route) is the **`found ⊆ oracle` guardrail: it must be 0** — a non-zero
value is a harness/terms bug, not a metric. Cost distributions reuse `summarizeDistribution` from `metrics.ts`;
`timeToFirstPlanMs` is distributed over found queries only, the rest over all queries.

### The discovery sweep runner

`sim/sim-runner.ts` mirrors the oracle sweep runner (`runner.ts`): a `SimSweepSpec` (`{ base: SimScenario,
vary, seeds }`) becomes one `SimRunRecord` per `(cell × seed)`. It shares the cartesian/vary machinery with
the oracle runner through `sweep-vary.ts` (one copy of `cartesian` / `coordsOf` / `setByPath` /
`requireNonEmptyValues`, so the two runners cannot drift). Unlike the synchronous oracle runner it is an
**`async` generator** — settling a query awaits `clock.runUntilIdle()` — so `runSimSweep` must be iterated
with `for await`; `runSimSweepToArray` collects a small sweep. It streams (no record retained) and touches no
filesystem; `cli/simulate.ts` drives it for file output (see § Output serialisation and the CLI) and a browser
viewer can drive the same code live.

Per run it materialises the network, builds the oracle on the **full, undegraded** network (conditions
degrade only the protocol run, never ground truth), draws a payment workload with `drawPaymentQueries` (pair
then amount, the same draw order as the oracle runner, so the two consume their seeded streams identically),
runs each query, and pairs every query's trace + outcome with the oracle's verdict via `analyzeQuery`. The
three seed streams mirror the oracle runner: network (`network.seed + runSeed`), workload (`workload.seed +
runSeed`), conditions (`(conditionsSeed ?? 0) + runSeed`). A sub-two-entity network emits `workload.queries`
degenerate zeroed results, the same guard the oracle runner uses.

`SimRunnerDeps.concurrent` (default sequential) issues every query before a single `runUntilIdle()`, for
speed. It is kept: both modes produce **byte-identical** records — outcome metrics (found, messages, nodes,
prune reasons, `pFoundGivenExists`), `roundsUsed` and the timing distributions alike — by an arm-order
invariant, not coincidence. The `tallynet` `VirtualClock` breaks a same-instant timer tie by insertion order
(`seq`); within one search, a round's delivery timers are always armed before that round's budget timer, and
an answer-delivery back to a node is always caused after that node armed its budget — so an exact
budget/delivery tie resolves the same way regardless of what other sessions' timers interleave in concurrent
mode. See `sim/sim-runner.ts`'s module header for the full argument and `sim-runner.test.ts`'s
concurrent/sequential guard sweep, which pins it against a future engine change.

### Found vs. oracle — the discovery experiment

`experiments/found-vs-oracle/` is this tier's first checked-in result, the discovery counterpart to the oracle
tier's § *First experiment*. It asks **how close the decentralised protocol gets to the oracle, and what that
costs**, over three one- or two-dimensional sweeps at one fixed mid-degree topology (`scale-free`,
`edgesPerNode = 3`, mean degree ≈ 6, **unlimited** capacity so each sweep isolates the swept variable from any
capacity gating), 50 queries, seeds `[1, 2]`. The headline is `pFoundGivenExists`; every committed record
satisfies the `falseFoundCount === 0` guardrail (found ⊆ oracle). `regenerate.sh` reproduces the committed
`out/*.{jsonl,csv}` and the combined `found-vs-oracle.jsonl` byte-identically and runs in well under a minute.

**What the data shows.**

1. **Depth — no reach gap; depth is pure cost.** The sim runner probes the oracle at the protocol's *same*
   `maxDepth`, and since `tallynet-discovery-depth-reach` the protocol's reach is `maxDepth = L` (one round per
   level, § "Rounds ↔ hops"), so the comparison is apples-to-apples with **no depth doubling**. Sweeping
   `D ∈ {2..6}` × `N ∈ {100, 1000}`, `pFoundGivenExists = 1` in **every** cell: the protocol finds every route
   the oracle sees at matched depth. The depth gap an earlier design feared (reach ≈ `⌊maxDepth/2⌋ + 1`) was a
   simulator-clock artifact, now gone — so this write-up reports the matched-depth result directly rather than
   budgeting `maxDepth` at 2× or labelling a cadence cost. Depth instead shows up as **cost**: as `D` rises the
   oracle's `routeExistsCount` climbs (more targets reachable) and the protocol tracks it exactly, while
   `messages` grow with depth and `N` (e.g. `N = 1000`: mean ≈ 7 at `D = 2` → ≈ 400 at `D = 4`, plateauing once
   every query's route is found by `D ≈ 4–5`). `roundsUsed` stays a low single digit (2–4): the originator
   stops at the first round that yields a satisfying plan, so hub-short paths conclude early.

2. **Sleeping nodes — success falls steadily; the oracle keeps counting the dark relays.** At a generous
   `D = 6` (so reach is never the binding constraint), sweeping `sleepingFraction ∈ {0..0.5}` drives
   `pFoundGivenExists` down roughly linearly — ≈ 1.0 → 0.87 → 0.78 → 0.57 → 0.48 → 0.39 as 0 → 50 % of nodes go
   dark. The oracle always runs on the **full, undegraded** network, so `routeExistsCount` holds at 50 while the
   protocol loses the relays it needs: each sleeping non-target relay severs the paths through it, and a query
   fails only when *all* its routes pass through dark nodes — hence the gradual fall, softened by the scale-free
   redundancy. `nodesTouched` falls monotonically with the shrinking reachable set (≈ 22 → 5); `messages` rise
   slightly at low sleeping (blocked candidates provoke more exploration) before falling as the reachable graph
   collapses.

3. **Latency — pure cost, success and rounds unmoved.** With reliability kept ideal (no drops/sleeping) and a
   budget that never binds, sweeping a constant per-link `latency ∈ {0..200}` ms leaves `pFoundGivenExists`
   pinned at 1 and `roundsUsed` flat (rounds are depth-bound, not latency-bound), while `timeToCompletionMs`
   grows **linearly** with latency — mean ≈ 0 → 21 → 106 → 213 → 426 ms, max = latency × 6 for the deepest
   (3-round) query, i.e. one round-trip (2× latency) per round. Latency buys nothing and costs wall-clock in
   direct proportion.

The headline for Taleus: at matched depth the greedy distributed search is **not** the bottleneck — it finds
what the oracle finds — so the real losses come from the network going dark (sleeping relays), and latency is a
pure time cost that never threatens success. (Realistic finite capacity, degraded further, is the natural next
sweep; this first cut holds capacity unlimited to keep the variables clean.)

> **Cost-ceiling tripwire.** Route discovery is ~O(network) per query — seconds-scale, far costlier than the
> oracle's bounded BFS (a `NOTE:` marks this at the sim runner's per-query loop in `src/sim/sim-runner.ts`).
> Discovery experiment grids must stay modest (small `N`, few seeds, ~50 queries) to keep `regenerate.sh`
> agent-runnable (well under ~10 min); if a sweep ever needs large `N`, record only sampled queries rather than
> running every pair.

## Consensus simulation

Discovery answers *did the protocol find a route*. The **consensus simulation** tier (`src/sim/plan-select.ts`,
`route.ts`, `consensus-harness.ts`) answers the next question: *given a found route, does the real
sign-and-settle lift commit, and what does it do to the network?* It takes a settled `QueryOutcome`, picks one
plan, drives the actual `tallynet` promise/commit engine over that exact route on the same `VirtualClock`, reads
commit/void/stall, and — on commit — moves each tally's balance along the route so the next query sees the
changed capacity. The consensus engine itself is **not** rebuilt here: the prereq wired `buildSimNetwork`'s
`consensus?: { identitySeed, resourceFor? }` option, which builds one `ConsensusNode` per graph node over the
existing harness (deterministic ed25519 identities from `sim/identity.ts`; failure-injecting resource ports from
`sim/consensus-resource.ts`). This tier composes that wiring into one call, `runLiftForOutcome`.

### Picking a plan

Discovery returns *every* satisfying plan; a payment settles exactly one. `sim/plan-select.ts` holds the
originator's policy. Only **`shortest`** ships (fewest `path.length`, ties broken by first-found — the incumbent
is replaced only on a strict `<`, so the earliest minimum wins), exposed as a named `PlanPolicy` so a later
experiment can sweep alternatives. Empty plans ⇒ `undefined`, and the caller skips the consensus phase (nothing
to settle).

### Reconstructing the exact route

A found plan's `path` is a list of anonymised edge **nonces** (`makeNonce(sessionCode, linkId)`), not link ids —
a node never reveals a raw link id on the wire. The simulator built the network it is decoding, so it inverts the
hash: `sim/route.ts` recomputes `makeNonce(sessionCode, linkIdForTally(i))` for every tally `i` to build `nonce →
tally index`, then walks from the originator across each tally's `{ stock, foil }` endpoints. It returns a
`LiftRoute = { tallyPath: number[]; route: number[] }` — the tally crossed at each hop, and the entity-id path
`[from, …, to]`. This is the same inversion the viewer's `deanonymise.ts` does, with one deliberate difference:
it **throws** on an unresolvable nonce or a non-contiguous walk rather than returning a sentinel. The viewer
decodes foreign traces (bad input is data); here the sim built the network and ran the discovery, so either is a
bug in this tier, not an input to tolerate.

### Driving the lift

`runLiftForOutcome(sim, network, outcome, q, options?)` assembles a `LiftSpec` from `tallyPath` + `route` +
`q.amount` and drives it:

- **Members & voters.** Every distinct entity on the route is a participant (`['P']`); the voter set (default
  `[route[0]]`, the originator) additionally gets `['V']`, so a default lift settles on the originator's own vote
  — the voter model, a voter set of one. A circular lift (`route[0] === route[last]`) lists
  the originator **once** in `members` though it sits on two links; `buildLift` resolves the route pairs anyway.
- **Exact tally selection.** `routeLinkIds: tallyPath.map(linkIdForTally)` picks the *discovery-chosen* tally at
  each hop, not merely the first edge to the neighbour — essential when a pair holds parallel tallies and only
  one carried the capacity the search used.
- **Codes.** The discovery `sessionCode` is reused; `buildLift` mints the transaction code off the shared seeded
  random, so the whole discovery+consensus pass is deterministic for a given query sequence.
- **Payload.** `{ amount: String(q.amount) }` — a **string**, because DAG-CBOR rejects a bigint/number caveat on
  the covered payload.
- **CBOR-safe link intents (load-bearing).** `recordDigest` DAG-CBOR-encodes `topology.links[*].intents`, and
  DAG-CBOR **throws on `Infinity`** — which an `unlimited`-capacity tally carries in `capFwd`/`capBack`, the
  *default* distribution in the committed `found-vs-oracle` experiment. So, after `buildLift` and **before**
  `start`, each lift record's link intents are rewritten to a finite copy (non-finite → `Number.MAX_SAFE_INTEGER`).
  TallyNet never interprets terms, every node signs the same sanitised record, and nonces are keyed by
  `sessionCode`+`linkId` (independent of intent values), so this is safe and leaves settlement unaffected. Only
  *this* lift record is sanitised — never the shared discovery adjacency, whose terms are pinned byte-identical by
  the discovery sweep.
- **Outcome.** `consensusNode(originator).start(record)` then `clock.runUntilIdle()` — the single drive fires
  the protocol's own deadline one-shot and periodic recovery ticks, so a stalled lift resolves *itself* inside
  it (no simulator-driven pull). The result is read from `outcome(txCode)` as `'commit' | 'void' | 'pending'`.
  `pending` is the **permanently-stuck** third outcome: a needed party never returned, so the promise phase
  never completed, no vote was cast, and the recovery loop abandoned past its give-up ceiling — the lift
  settled nowhere, surfaced not thrown, with credit still held. (A late-but-*completing* lift is **not**
  `pending`: it self-voids by its own deadline — the completed promise set reaches the voter post-expiry, so
  `castCommit` votes `NC` — and reads `void`. A split voter set that clears no threshold is also `pending`.) A
  clean run leaves `net.deliveryErrors === []` even when a participant refuses (the engine catches it and signs
  `NP`) or a needed push is dropped.

### Moving money on commit

Only on `commit`. Payment flows originator → target; for each hop `u → v` resolved to tally `t`, value flows
`u → v`, and `capacity.ts`'s single directed helper `applyLiftToBalance(tally, fromIsStock, amount)` moves the
balance: `fromIsStock = (tally.stock === u)`. Payer-is-stock (value stock → foil) lowers `b` toward
`-foilCreditLimit`; payer-is-foil (value foil → stock) raises `b` toward `+stockCreditLimit` — the exact inverse
of the directed-capacity formulas, so a lift consumes precisely the capacity it flows across. A single lift over
the found route stays in bounds (discovery already proved `capFwd ≥ amount` each hop); the driver nonetheless
**asserts** `-foilCreditLimit ≤ balance ≤ stockCreditLimit` after every hop, catching any route-reconstruction or
direction bug. `Infinity` limits make the bound trivially pass and the balance stays finite (plain arithmetic,
never CBOR). Conservation follows: each intermediary's net position is unchanged (the signed change on its
in-tally equals that on its out-tally); only payer and payee see a net move, and a circular lift nets zero at
every node around the loop.

### Seeing the changed capacity needs a rebuild

`InMemoryNetwork` freezes each link's terms from `network.tallies` at **construction**, so mutating
`network.tallies[t].balance` afterward does **not** change an already-built sim. For "the next query sees the
changed capacity," rebuild `buildSimNetwork(network, …)` from the mutated model before the next query. Within one
run a *sequence* of lifts mutates the one kept network in order. Because the driver mutates the `network` it is
given, a caller holding a `materialized`-by-reference network must `cloneNetwork(network)` (`model.ts`) per run,
mirroring the `materializeNetwork` NOTE — otherwise one run's committed lifts would contaminate the next. Same
`(network, identity, workload, conditions)` seeds ⇒ identical member keys, outcome, and resulting balances; the
dedicated identity-seed stream is the determinism guard.

### Failure injection in the consensus phase

Two independent dials degrade sign-and-settle, so an experiment can ask *how often a found route actually
commits, and why the rest don't*:

- **Refusers — a consensus-only dial with its own seed stream.** `consensus.refuserFraction` marks exactly
  `round(fraction · entityCount)` entities as **refusers** (`compileConsensusConditions`, reusing the same
  count-based partial-shuffle selector § Network conditions uses). A refuser that lands on a taken route
  declines to promise — its resource port signs `NP` (no-promise) — so that lift **voids** with reason
  `refused-promise`. The selection is drawn from a **dedicated** `SeededRandom` stream (the *refuser* seed,
  `consensusSeed`), independent of the network / workload / conditions / identity streams — the same
  discipline the conditions stream follows, and for the same reason: *do not perturb the discovery streams.*
  Turning refusers up must not shift which network a run builds or which queries it draws (nor, via the
  separate `consensus.identitySeed` stream, anyone's keys).

- **Network conditions degrade BOTH phases.** The discovery `conditions` block (sleeping nodes, dropped
  links, latency — § Network conditions) is **not** re-drawn for consensus; the one compiled per-link
  condition map governs both. Discovery's `queryPeer` and the consensus engine's record *push*
  (`updatePeer`) resolve a link's `drop` / `latencyMs` through the **same** map (`tallynet`'s
  `InMemoryNetwork.pushCondition` reuses `resolveCondition`). So a sleeping or dropped link that blocks a
  discovery delivery **also** drops the consensus record push across it, and a late link that slows a query
  **also** slows the push — and a push delayed past a code's time-to-live (600 000 ms of virtual time, § the
  experiment below) expires it, so the lift **voids** with reason `expired` rather than merely settling late.

**The sleeping/dropped-target stall (the one asymmetry worth knowing).** Discovery and consensus treat the
*final hop to the payee* differently, and that difference is where a found route can still fail to settle:

- In discovery the payee surfaces as a **peer-match terminus**: the payee's *neighbour* recognises it from
  its own adjacency and resolves the last hop without ever delivering a message to the payee. So a route to a
  sleeping (or dropped-link) payee is still **found** — that dark final link is never exercised.
- In consensus the lift record **must** reach every participant, the payee included, and that push crosses
  the very link discovery skipped. If the link drops, the record never arrives and the lift **stalls** — it
  settles nowhere and is surfaced as `pending` (reason `stalled`).

So a sleeping/dropped **target** yields a found-but-stalled lift on a single build, whereas a sleeping/dropped
**relay** severs the route back in discovery (no route found, no lift at all). Either way the dark node costs
a payment, but it reaches the metrics by a different path — a missing `found` versus a `pending`.

**Protocol self-recovery softens the stall, but a dark edge can still strand a line.** The commit engine now
runs a **recovery loop** (landed in `tallynet-stalled-recovery`): each node arms a deadline one-shot and
periodic recovery ticks that all fire inside the simulator's single drive-to-idle, so a stalled lift resolves
*itself* under the clock in one of three ways, with **no simulator-driven pull**:

- **Deadline void (self-resolution).** A lift that keeps waiting on a slow party — the completed promise set
  reaches the voter only *after* the code expiry — self-voids by its own deadline: the voter casts `NC`
  through `castCommit`'s expired path and the route reads `void`. The promise phase still *completes* (a late
  promise is accepted); it is the completing *vote* that lands post-expiry. (`consensus-timeout.test.ts`
  § *a lift waiting on a slow voter voids by its own deadline*, mirroring tallynet `consensus.test.ts` ≈:1249.)
- **Recovery-loop healing.** A member an interior non-relayer cut off from the commit push pulls the settled
  evidence *itself* from a reachable contact point or link-neighbour (see the § *Voter model*
  record-availability curve below) and commits — a stranded member recovers rather than staying dead.
- **Abandonment (permanently pending).** A lift whose needed party never returns — the promise phase never
  completes, so no vote is ever cast — has its recovery loop back off and **abandon** past the give-up ceiling
  (`consensus.recoveryGiveupMs`, kept small in the sim so a stuck lift abandons fast rather than polling a
  virtual hour of backoff ticks), leaving the lift `pending` with credit still held. This is the
  **permanently-pending** outcome the metrics below count. (`consensus-timeout.test.ts` § *a needed party that
  never returns abandons and stays pending*, mirroring tallynet `consensus.test.ts` ≈:400.)

Where a pull has
somewhere to reach — a published contact point, or a ring that delivers both ways — the lift completes for
every cooperating member. Where it does not — a straight line with no contact points, whose stranded members'
only peers are the non-relayer and each other — the completion cliff remains: those members stay `pending`
even though the originator committed and the money moved. A *dropped-link* stall (the sleeping/dropped-target
asymmetry above) is harder still: with no settled record anywhere to pull, the lift settles nowhere
(`pending`, reason `stalled`). The self-*re-routing* that would close these remaining gaps at the protocol
level — choosing an alternate path to the evidence when the direct one is dark — is **phase-2** work, tracked
in `tallynet-propagation-timeouts`; until it lands, read a `pending` as "a needed message was lost and no pull
could reach the evidence."

### Voter model

Beyond the two failure dials above, the consensus tier models **who votes on a lift and how a payer reacts to
the voter set it is offered**. There are no global rules — every dimension is a per-lift proposal parameter a
node accepts or refuses — and each dimension is a `ConsensusSpec` knob (all JSON-serialisable, so a scenario
round-trips through a trace header).

- **Voter nomination (`voterNomination`).** `self` (the implicit default) is a **voter set of one**: the
  originator votes its own leg and no extra wiring is needed. `well-known` nominates the single most-recognised
  off-route hub as a shared trusted voter the whole route folds in as a `[V]` referee. A **known limitation**:
  the discovery layer folds a nominee as a *separate* voter-only member and only de-duplicates against members
  already on the plan, so nominating a node that is **itself on the money path** does not upgrade it to
  `[P, V]` — its referee vote is silently dropped (`well-known` picks a high-degree hub that is frequently
  on-path). The clean fix — marking on-path participants `[P, V]` directly rather than routing on-path votes
  through referee nomination — is `backlog/debt-voter-nomination-on-path-composition`; the model here works
  **within that gap**, which is why it is exercised only with off-route hubs.

- **Well-known is a graph property, not a flag (`wellKnownFraction`).** There is no "well-known" field in the
  `Network` model and we do not add one — a flag would ripple through serialisation and perturb the pinned,
  byte-identical discovery sweep. Instead the well-known set is **measured from the graph**: the top
  `round(fraction · entityCount)` entities by degree (`wellKnownEntities`, ties → lower id), on the premise
  that the highest-degree hubs are the nodes the rest of the network most recognises. This is the deliberate
  departure from the original `5.5` sketch, which imagined an explicit marking; measuring from degree keeps
  the model untouched and fully deterministic. The voter-aware plan scorer uses the same set to tell a trusted
  voter from an obscure one.

- **Contact points and the completion curve (principle 3).** A lift can publish a `physical` contact point on
  its originator and voters (`consensus.contactPoints`); a member an interior non-relayer cut off from the
  commit push then pulls the settled record from one of them. The **non-relayer** completion curve
  (`consensus.nonRelayerFraction`, the swept x-axis; `cooperatingCompletion` the y-axis — see the sibling core
  ticket's metric) measures how many of the members *allowed* to reach commit actually did. With contact
  points, or on a ring that delivers both ways around an interior non-relayer, completion holds at 1.0; a
  straight line with no contact point shows the cliff (its stranded members have no path to the evidence).

- **Non-relayer vs refuser — two different failures.** A **refuser** signs `NP` on a route it sits on, so the
  whole lift voids (`refused-promise`). A **non-relayer** promises normally but then drops every commit-phase
  record it would forward and serves no pulls — it does not void the lift, it *strands* the members behind it,
  which the completion curve measures. The two are injected on independent fractions.

- **Protocol-driven pull (recovery loop landed).** Recovery moved into the protocol in
  `tallynet-stalled-recovery`: each node's deadline one-shot and periodic recovery ticks fire inside the
  simulator's single drive-to-idle, so a stranded node pulls the settled record **itself** — the simulator
  drives no pull pass. Self-*re-routing* around a dark edge (choosing an alternate path to the evidence) is
  still deferred to `tallynet-propagation-timeouts`.

- **Circular routes as the clearing-discovery stand-in (`routeShape: 'circular'`).** Real clearing discovery —
  a node *finding* a cycle back to itself over the decentralised protocol — is deferred
  (`feat-tallysim-clearing-discovery`). Until it lands, a circular run draws a single origin per query
  (`drawCircularOrigins`), mints a real session code with a self-query, and builds the shortest simple cycle
  through the origin **straight from the graph** the simulator already holds (`buildCircularOutcome`). This
  exercises the circular consensus path — notably "a ring routes around a non-relayer with no contact points at
  all" — without waiting on the discovery work.

- **Stacked-voter refusal, measured at the discovery layer (`stackedVoters`).** A padding node can staple
  obscure referees — voter-only members the payer does not recognise — onto a plan's voter set; a payer that
  vets voter sets **refuses** such a padded quorum. This refusal is measured at the **discovery scorer**, not
  the promise-time `acceptsProposal` gate, for a structural reason: in this tier the nominated/stapled referees
  reach the *discovery* layer only — they are built from the route + voters and never land in the lift record's
  members (the same composition gap the nomination limitation above names). So the promise-time gate would
  never see them. Instead the originator's plan scorer drops any stacked plan (`-Infinity`, which the
  originator's ranking filters out) and counts it into `planRefusalCount`. The voter-aware *reordering* of lean
  vs. padded plans is a ranking, not a refusal, and is intentionally **not** counted.

- **Consensus method / threshold override (`consensusMethod`).** Every lift settles under a `ConsensusMethod`
  (vote weighting + win threshold), defaulting to `tallynet`'s plain strict-majority `1/2`. Raising it (e.g.
  `2/3`) can leave a split voter set settling **nowhere** (`pending`) where a `1/2` lift would have committed —
  the winning side must clear both the strict-majority floor *and* the raised fraction of total vote weight.

- **New metrics / CSV columns.** The stacked-voter dimension adds `planRefusalCount` and `planRefusalShare`
  (`= planRefusalCount / queryCount`, 0 when no queries) to `ConsensusRunMetrics`, emitted as CSV columns after
  `pullMessagesPerLift.*`. They count **discovery-time** plan refusals, distinct from voided lifts. The timeout
  dimension then appends the `creditHeldMsPerLift` distribution and the `permanentlyPendingCount` /
  `permanentlyPendingFraction` scalars as the final columns (see § *Consensus metrics*).

### Consensus metrics

`sim/consensus-metrics.ts` is the consensus tier's measurement layer — **recorded lift in, metrics out** —
pure like `protocol-metrics.ts` (no network / clock / filesystem), so it is testable from hand-built
`LiftResult`s plus consensus `TraceEvent`s and reusable in a browser viewer. It is the consensus analogue of
the discovery tier's § *Protocol metrics*: where that asks *did the protocol find a route*, this asks, of the
routes it found and took, **did the lift commit, how fast, how many messages, and — for a non-commit — why?**

`analyzeLift(events, result)` reduces **one** lift to a `ConsensusLiftMetrics`. It filters `events` by
`result.transactionCode` internally — every consensus event carries a `transactionCode` and no discovery event
does, so this cleanly drops discovery noise *and* every other lift's events in a concurrent batch. From this
lift's events it derives: `messages` = count of `record-pushed` (the push is the consensus message);
`pullMessages` = count of `record-pulled` (the protocol's **own** recovery-loop pulls — the simulator drives
none); `timeToSettleMs` = last consensus-event time − first `record-pushed`/`promise-signed` time, **omitted
for a `pending`** (nothing settled, so a deadline-driven void — itself a `void` — still contributes a span);
`recovered` = `1` iff the lift **settled** and its recovery loop ran (a `record-pulled` *or* `recovery-tick`
fired), else `0` — a clean happy-commit or refuser-void is `0`, so this counts the settled lifts that *needed*
recovery, which is non-zero in a drop sweep that strands a self-healing member; `creditHeldMs` = last
`resources-released` time − first credit-holding (`P`) `promise-signed` time (an `NP` holds nothing),
**omitted** when either endpoint is absent; `permanentlyPending` = the lift is `pending` **and** never released
its resources (credit tied up and never freed); and `voidReason`, by an **outcome-driven precedence** —
`commit` ⇒ none; `pending` ⇒ always `'stalled'` (a stray `NP`/`NC` that never reached a decision does not
override it); `void` ⇒ the first of `expired` (a `signature-rejected`), `'refused-promise'` (a `promise-signed`
`NP`), or `'voted-no-commit'` (a `voter-vote` `NC`). A deadline-driven timeout void emits no `expired`
signature-rejection — the engine surfaces it as a `voter-vote` `NC` — so it classifies as `'voted-no-commit'`.
(`zeroVoidReasons()` is the compile-checked source of truth for the reason set; `ALL_VOID_REASONS` derives from
it, so the two cannot drift — the same `pruneReasons` pattern the discovery tier's § *Protocol metrics* uses
for its reason set.)

`summarizeConsensusMetrics(lifts, structural, queryCount)` aggregates a run into `ConsensusRunMetrics`. The
headline is **`pCommitGivenFound`** = `commitCount / liftCount` — P(commit | a route was found and a lift
attempted), the consensus complement of the discovery tier's `pFoundGivenExists`, and **0 (never NaN)** when no
lift ran. Cost distributions reuse `summarizeDistribution` from `metrics.ts`; `timeToSettleMs` is distributed
over the settled lifts only (a pending contributes no sample), `messagesPerLift` over all lifts; `voidReasons`
sums each non-commit lift's reason. It also sums the record-availability aggregates: `cooperatingCompletion`
= `cooperatingCommittedTotal / cooperatingMemberTotal` (of the members allowed to reach commit — route
entities minus the injected non-relayers/silent — the fraction that committed, **0 not NaN** when none),
`pullMessagesPerLift` over all lifts, and `recoveredTotal` = Σ `recovered` (the settled lifts whose recovery
loop ran); see the voter-model subsection for what those knobs mean. The timeout measurements add
`creditHeldMsPerLift` (distributed over the lifts whose `creditHeldMs` is defined, like `timeToSettleMs`) and
`permanentlyPendingCount` with `permanentlyPendingFraction` = `permanentlyPendingCount / liftCount` (**0 not
NaN** when no lift ran) — how often a lift ties credit up and never resolves. `queryCount` and the
`StructuralMetrics` carry through from the runner unchanged.

### The sequential consensus sweep runner

`sim/consensus-runner.ts` is the consensus counterpart to `sim-runner.ts`: `runConsensusSweep(spec)` turns a
`SimSweepSpec` into a stream of `ConsensusRunRecord`s — one per `(cell × seed)`, same provenance shape as
`SimRunRecord` with a `ConsensusRunMetrics` payload. For each run it clones the materialised network
(`cloneNetwork(materializeNetwork(…))` — the driver mutates balances, so each run starts from a pristine copy),
draws the payment workload, then drives **each** query through the whole pipeline: `buildSimNetwork` → `runQuery`
(discovery) → `runLiftForOutcome` (sign-and-settle; mutates balances on commit) → `analyzeLift`, finally
`summarizeConsensusMetrics`. A sub-two-entity network short-circuits to a fully-zeroed `ConsensusRunMetrics`
(no pair, no query, no lift), mirroring the discovery runner's degenerate guard.

- **Sequential only (load-bearing).** A committed lift moves `tally.balance` on the one kept network, and the
  next query must see that changed capacity, so the lifts form an **ordered** sequence — a between-lifts balance
  is defined only under a fixed order. There is therefore no `concurrent` dependency here (unlike `sim-runner.ts`,
  whose queries mutate no shared state); offering one would make balances order-dependent and the sweep
  non-deterministic.
- **Rebuild per query.** `InMemoryNetwork` freezes link terms at construction (see § *Seeing the changed capacity
  needs a rebuild*), so each query rebuilds `buildSimNetwork` from the mutated network with a fresh events array;
  `analyzeLift` filters by this lift's `transactionCode`, so session/transaction-code collisions across rebuilds
  never mix lifts. Refusers are compiled once per run (`compileConsensusConditions`) and the resource port is
  built once (its promise/commit gates are stateless), so the refuser set stays stable across rebuilds. This
  rebuild-per-query-on-one-mutated-network design is the **deliberate opposite** of the consensus *trace*
  (§ Trace & replay format), which drives each lift against a throwaway `cloneNetwork` copy and so models **no**
  capacity depletion: the metrics sweep measures how committed lifts deplete capacity over a run, the trace
  only records one representative pass. The two are each internally deterministic and need not agree.
- **Seed streams.** Every base seed is offset by the run seed, mirroring `sim-runner.ts` plus the two consensus
  streams: network, workload, conditions (`conditionsSeed`), refuser (`consensusSeed`) and identity
  (`consensus.identitySeed ?? DEFAULT_CONSENSUS_IDENTITY_SEED`). The refuser/identity streams are independent of
  the discovery streams, so failure injection never shifts which network/queries a run gets.
- **Validation widening.** A materialised network is shared by reference, so structural vary paths stay forbidden;
  but the materialised-network guard is widened past `workload.*` to also accept `conditions.*` and `consensus.*`
  (both cloned one level deep per cell), because the consensus CSV x-axis is typically `consensus.refuserFraction`
  or `conditions.dropFraction`.

The sweep-plumbing helpers (`validateConsensusSweep`, `applyVary`, `cloneSimScenario`, `cloneConditions`,
`cloneCapacity`) are presently **duplicated** from `sim-runner.ts` (private there) rather than shared, to keep the
pinned byte-identical discovery sweep untouched; extracting a common module is tracked as follow-up tech debt.

### Commit vs. found — the consensus experiment

`experiments/commit-vs-found/` is this tier's first checked-in result, the consensus counterpart to the
discovery tier's § *Found vs. oracle*. It asks **of the routes the protocol finds, how many commit, and why do
the rest fail**, over two one-dimensional sweeps at one fixed mid-degree topology (`scale-free`,
`edgesPerNode = 3`, mean degree ≈ 6, **unlimited** capacity so a non-commit is always a failure-injection
effect, never a depleted tally), 50 queries, seeds `[1, 2]`, consensus enabled. The headline is
`pCommitGivenFound`. `regenerate.sh` reproduces the committed `out/*.{jsonl,csv}` and the combined
`commit-vs-found.jsonl` byte-identically and runs in ≈ 2 minutes.

**What the data shows** (averaged over seeds).

1. **Refusers void found routes, faster than linearly.** Sweeping `consensus.refuserFraction ∈ {0..0.5}` (its
   own seed stream, so discovery is untouched — `liftCount` holds at 50), `pCommitGivenFound` falls
   `1.00 → 0.68 → 0.51 → 0.26 → 0.19 → 0.09`. A refuser *anywhere* on a route voids the whole lift, so survival
   compounds ≈ `(1 − fraction)^(route length)` — 10 % refusers already cost a third of commits. Every non-commit
   is a clean `void` (`refused-promise`); a refusal is detected and the lift abandoned in order.

2. **Dropped links cost twice — fewer routes found, and found routes stall.** Sweeping
   `conditions.dropFraction ∈ {0..0.5}` (the shared conditions map, degrading both phases), routes found fall
   `50 → 33.5` while, among those found, `pending` stalls rise `0 → 14.5` — the sleeping/dropped-target
   asymmetry (§ *Failure injection in the consensus phase*): discovery peer-matches a dark terminus and still
   finds the route, but the consensus push over the dropped link is lost and, with no v1 timeout, the lift
   settles nowhere. `pCommitGivenFound` falls `1.00 → 0.57`; every non-commit here is a `stalled` pending (no
   refusals).

The headline for Taleus: **a found route is not a committed payment** — a cooperative, reliable network commits
every route it finds (the correctness floor, `pCommitGivenFound = 1`), but refusing nodes abandon lifts
*cleanly* while lost messages leave them *hanging*, and until `tallynet-propagation-timeouts` lands a single
lost push strands an otherwise-valid lift.

## Trace & replay format

A simulation run can be recorded to a **versioned, newline-delimited JSON (NDJSON)** trace file — one that
the viewer animates and the protocol-metrics tier analyses — such that a recorded run **replays
identically**. The format and its read/write machinery live in `sim/trace-format.ts` and
`sim/trace-writer.ts`; the Node file driver is `cli/trace.ts`.

**Three line kinds, in this order.** Every line is one JSON object with a `kind` discriminant:

- **line 1 — `header`**: the trace-format version, the tallysim and tallynet package versions, the full
  `SimScenario` the run was built from (so the run is reproducible from the file alone), the run seed, and
  one `queries[]` entry per recorded query — `{ sessionCode, from, to, amount, depth }` — so a reader joins
  any event back to its query by `event.sessionCode` without splitting the stream. On a **consensus** run
  (a scenario carrying a `consensus` block) the header also carries `lifts[]` — one `TraceLiftEntry` per
  recorded query that found a route — `{ sessionCode, transactionCode, route, tallyPath, memberKeys, amount }`.
  A consensus event addresses nodes by **member key** (an ed25519 public key), not entity id, and the route
  a lift took is not recoverable from the discovery event stream; so each lift's route plus its member-key →
  entity-id map rides in the header, letting a reader place consensus events on the graph and show the chosen
  route. The field is **absent** on a v1 file and on a discovery-only v2 run (no empty array).
- **line 2 — `network`**: the serialised `Network`, reusing the model's one `Infinity ↔ null` encoding
  (`networkToSerialized`/`networkFromSerialized`), so the reader rebuilds a byte-identical graph.
- **lines 3+ — `event`**: one `tallynet` `TraceEvent` per line, verbatim, in emission order — which is time
  order, because the `VirtualClock` fires in `(time, seq)` order.

The header and network come first so a streaming reader can set up before the events arrive.

**Versioning.** `traceFormatVersion` is checked on read; an unsupported value is rejected with a message
naming the found version and the supported set (the viewer relies on this). The reader currently accepts
**v1 and v2**. Bump it only when a **line envelope** above changes. A new *event kind* never forces a bump:
the `TraceEvent` union already spans discovery *and* consensus, so the writer and reader pass the whole union
through unchanged. The v1 → v2 bump was a **header** change — the new optional `lifts[]` field — not an event
change; a hand-built consensus event still round-trips under v1.

**Streaming, both ways.** Writing is append-only: `makeTraceWriter(header, snapshot, out)` emits the header
and network up front, then serialises each event to one line and hands it to the caller's `LineSink` *as it
arrives*, never accumulating the event list — so a 10,000-node run stays flat in memory. Its `stats()`
reports running line and byte counts (each line plus its one newline), so a run can report its trace size
and a caller can cap recording. Reading is lazy: `parseTrace(lines)` reads the header and network eagerly
and yields events through a single-pass generator, so a large trace is never fully materialised. The core
stays platform-neutral (the viewer records runs live in a page); only `cli/trace.ts` touches the filesystem,
wiring the `LineSink` to a streamed file write.

**Selected-query recording.** `makeTraceWriter`'s `options.sessions` records only a chosen set of session
codes — a huge run can record just a handful of queries. The header then lists **only** the recorded queries
(the recorded-only variant), so the file stays self-consistent: every `queries[]` entry has events, and
every event's session is in `queries[]`.

**Byte-identical determinism.** The same seed + same `SimScenario` produce a byte-identical trace file —
header, network snapshot, and every event line in the same order. This rests on the `VirtualClock`'s
`(time, seq)` fire order and deterministic session-code minting (see § Discovery simulation). Because a
session code is minted *inside* `discover()` and is not knowable until a query has run, the `cli/trace.ts`
driver runs the batch twice: pass 1 learns the session codes (collecting codes only, so memory stays flat),
pass 2 rebuilds an identical network and reruns the same queries, streaming their events — the rerun
reproduces the same codes and events exactly, which is this determinism guarantee in action. On a consensus
run each pass also drives every found query's **lift** to settlement: pass 1 records the `lifts[]` header
entries (transaction code, route, member map), pass 2 reruns the lifts so their consensus events stream into
the file and join back by `transactionCode`. The consensus trace builds **one** sim per pass (session and
transaction codes keep minting on a single RNG, so they stay unique across the pass) and discards each lift's
balance move against a throwaway `cloneNetwork` copy, leaving the recorded network snapshot the pristine
initial graph — it deliberately does **not** model capacity depletion, unlike the consensus *metrics* sweep
(§ Consensus simulation), which rebuilds per query and mutates one kept network. The two are each internally
deterministic and need not agree, exactly as the discovery trace already seeds differently from the sweep.
The trace CLI drives only the **linear** route shape — it always `drawPaymentQueries`; `routeShape: 'circular'`
is a **sweep-only** feature this tier (the trace still threads the stacked/nomination/method wiring through
`consensusConfigFor`, so a linear consensus trace replays its discovery identically). Driving circular route
shape through the trace recorder is deferred alongside real clearing discovery (`feat-tallysim-clearing-discovery`).

A **late answer** (`late-answer-folded`) appears in the stream at its own clock time with its round, so a
reader sees it folded into a later round — not dropped, not duplicated. An **empty run** (a query that finds
nothing, or a run whose queries are all filtered out, or a network of fewer than two entities) still yields a
valid header + network file.
