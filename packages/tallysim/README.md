# tallysim

Platform-neutral simulator for Taleus tally networks. It answers Taleus's central research question in two
independent halves: **how connected must a tally network be before a payment can usually find a route
through it** (measured by a whole-graph *oracle*), and **does the real `tallynet` routing protocol find the
routes the oracle proves exist** (measured by replaying the protocol on the same graphs).

**Status:** network-model tier built. The package builds, tests and lints, and ships:

- the plain, JSON-serialisable **network data model** (`src/model.ts`) — entities (nodes) joined by tallies
  (edges), with an `Infinity` ↔ `null` serialisation sentinel for unlimited credit limits;
- the **directed-capacity model** (`src/capacity.ts`) — how much value a tally can carry each way before a
  credit bound, deliberately omitting trading-variable fees;
- the **capacity/balance distributions** (`src/distributions.ts`) — `unlimited`, `constant`, `uniform`,
  `lognormal`;
- four seeded **network generators** (`src/generators/`) — `uniform` (Erdős–Rényi), `scale-free`
  (Barabási–Albert), `clustered` (communities + bridges), `small-world` (Watts–Strogatz);
- pure **structural utilities** (`src/structure.ts`) — degree histogram / mean degree, and connected
  components / largest-component fraction via union-find.

The whole-graph oracle, the experiment runner + CLI, and the protocol-replay tiers come in later tess
tickets.

- [docs/design.md](docs/design.md): the canonical simulator design — tiers, model, capacity model,
  generators, PRNG, and stubs for the later tiers.

TallySim reuses `tallynet`'s seeded PRNG (`SeededRandom`, via the `tallynet/testing` subpath export) so a
single seed replays graph generation and, in later tiers, the protocol's own randomness. The core is
browser-safe (no Node globals, no `Math.random`, no result depending on unordered-key iteration); the only
Node-specific file will be the future CLI.
