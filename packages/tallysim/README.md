# tallysim

Platform-neutral simulator for Taleus tally networks. It answers Taleus's central research question in two
independent halves: **how connected must a tally network be before a payment can usually find a route
through it** (measured by a whole-graph *oracle*), and **does the real `tallynet` routing protocol find the
routes the oracle proves exist** (measured by replaying the protocol on the same graphs).

**Status:** network-model tier, oracle, **and the experiment runner + CLI** built. The package builds, tests
and lints, and ships:

- the plain, JSON-serialisable **network data model** (`src/model.ts`) — entities (nodes) joined by tallies
  (edges), with an `Infinity` ↔ `null` serialisation sentinel for unlimited credit limits;
- the **directed-capacity model** (`src/capacity.ts`) — how much value a tally can carry each way before a
  credit bound, deliberately omitting trading-variable fees;
- the **capacity/balance distributions** (`src/distributions.ts`) — `unlimited`, `constant`, `uniform`,
  `lognormal`;
- four seeded **network generators** (`src/generators/`) — `uniform` (Erdős–Rényi), `scale-free`
  (Barabási–Albert), `clustered` (communities + bridges), `small-world` (Watts–Strogatz);
- pure **structural utilities** (`src/structure.ts`) — degree histogram / mean degree, and connected
  components / largest-component fraction via union-find;
- the **compiled directed-capacity graph view** (`src/graph-view.ts`) — a `Network` compiled into CSR typed
  arrays for fast search;
- the whole-graph **oracle** (`src/oracle.ts`) — route existence + shortest length (bounded BFS),
  self-payment / circular-clearing cycles, max-flow (Edmonds–Karp), and capped clearing-cycle availability,
  anchored by an independent brute-force / min-cut verification harness;
- the **experiment harness** — the scenario/sweep model (`src/scenario.ts`), the streaming sweep runner
  (`src/runner.ts`), pure metric aggregation (`src/metrics.ts`), JSON-lines + CSV serialisers generic over the
  metrics shape (`src/serialize-records.ts` for the oracle sweep, `src/serialize-sim-records.ts` for the
  discovery sweep), and the Node-only CLIs (`src/cli/sweep.ts`, `src/cli/simulate.ts`, `src/cli/trace.ts`);
- a first checked-in experiment (`experiments/route-existence/`) measuring P(route exists) vs. connectivity.

The protocol-replay tiers come in later tess tickets.

Run a sweep (reads a `SweepSpec` JSON file, streams JSON-lines, optionally writes a CSV summary). `sweep` runs
the whole-graph oracle; `simulate` runs the real `tallynet` discovery protocol over a simulated network, and can
additionally dump a replayable trace of the sweep's base scenario:

```
yarn workspace tallysim sweep <spec.json> [--jsonl <out.jsonl>] [--csv <out.csv>]
yarn workspace tallysim simulate <spec.json> [--jsonl <out.jsonl>] [--csv <out.csv>] [--concurrent] \
    [--trace <trace.ndjson> [--query <i> ...] [--seed <n>]]
```

- [docs/design.md](docs/design.md): the canonical simulator design — tiers, model, capacity model,
  generators, PRNG, oracle, the runner/experiments tier, and the first experiment's finding.
- [experiments/route-existence/](experiments/route-existence/): the first checked-in experiment —
  committed specs, data, and a deterministic `regenerate.sh`.

TallySim reuses `tallynet`'s seeded PRNG (`SeededRandom`, via the `tallynet/testing` subpath export) so a
single seed replays graph generation and, in later tiers, the protocol's own randomness. The core is
browser-safe (no Node globals, no `Math.random`, no result depending on unordered-key iteration); the only
Node-specific file is the CLI (`src/cli/`).
