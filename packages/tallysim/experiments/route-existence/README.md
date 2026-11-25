# Experiment: route existence vs. connectivity

**Question.** How connected must a tally network be before a payment can usually find a route through it?

This is the tallysim runner tier's first checked-in result. It sweeps the whole-graph **oracle**'s
route-existence query over many generated networks and records, for each, the fraction of random payment
queries that find a route within a depth bound — **P(route exists)** — against the network's mean tallies per
entity (mean degree).

## Specs (`specs/*.json`)

Four committed sweep specs, each a `payment` route-existence sweep over seeds `[1, 2, 3]` with a constant
payment amount of 10 (so the *only* difference between an unlimited and a realistic run is capacity):

| spec | generator | capacity | degree parameter swept |
|---|---|---|---|
| `uniform-unlimited` | `uniform` (Erdős–Rényi) | unlimited | `meanDegree ∈ {0.5,1,1.5,2,3,4,6}` |
| `uniform-realistic` | `uniform` | `lognormal` `mu=3 sigma=1`, randomised balances | same |
| `scalefree-unlimited` | `scale-free` (Barabási–Albert) | unlimited | `edgesPerNode ∈ {1,2,3,4}` |
| `scalefree-realistic` | `scale-free` | `lognormal` `mu=3 sigma=1`, randomised balances | same |

Each also varies entity count `N ∈ {100, 1000, 10000}` and depth bound `D ∈ {4, 6, 8}` (a 3-dimensional
cartesian sweep). The `_note` field inside each spec is a human comment; the runner ignores unknown keys.

## Regenerating

```
./regenerate.sh          # rebuilds tallysim, runs all four specs, writes out/ + route-existence.jsonl
```

It writes per-spec `out/<name>.jsonl` and `out/<name>.csv`, then concatenates the four JSON-lines files into
**`route-existence.jsonl`** — one self-describing artifact (every record carries its generator, capacity kind,
swept coordinates and metrics). The sweep is fully deterministic: `regenerate.sh` reproduces the committed
output byte-identically. The whole grid runs in a few seconds (route existence is a cheap BFS).

## Finding

Recorded in [`../../docs/design.md`](../../docs/design.md) § Runner / experiments → *First experiment*. In
short: a giant component appears at mean degree ≈ 1, but *usable* depth-bounded routing needs `degree^D ≳ N`;
realistic (finite, partly-consumed) capacity raises the bar further; and hub-heavy scale-free topologies clear
it at much lower average connectivity than uniform random ones.
