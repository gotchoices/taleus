# Experiment: found vs. oracle

**Question.** Out of the routes that exist (the whole-graph oracle's ground truth), how many does the real
decentralised `tallynet` route-discovery protocol actually *find*, and what does it cost — as search depth,
sleeping nodes and latency vary?

This is the tallysim **discovery** tier's first checked-in result. Where the sibling
[`route-existence/`](../route-existence/) experiment sweeps the oracle alone (*does a route exist?*), this one
runs the actual protocol over a simulated network on compressed, deterministic time and pairs every query with
the oracle's verdict. The headline metric is **`pFoundGivenExists`** = P(found | a route exists) — the
complement of route-existence's P(route exists). The correctness guardrail is **`falseFoundCount === 0`** on
every record (found ⊆ oracle): the protocol never returns a route the oracle denies. Every committed record
satisfies it.

## Specs (`specs/*.json`)

Three committed discovery-sweep specs (`SimSweepSpec` files), each at one **fixed mid-degree topology** —
`scale-free` (Barabási–Albert), `edgesPerNode = 3` (mean degree ≈ 6), **unlimited** capacity, 50 queries,
seeds `[1, 2]` — so each sweep is one- or two-dimensional and isolates a single variable:

| spec | varies | holds | measures |
|---|---|---|---|
| `depth-sweep` | depth `D ∈ {2,3,4,5,6}` × `N ∈ {100, 1000}` | ideal conditions | `pFoundGivenExists`, messages, rounds |
| `sleeping-sweep` | `conditions.sleepingFraction ∈ {0,.1,.2,.3,.4,.5}` | `N = 100`, `D = 6` | `pFoundGivenExists`, messages |
| `latency-sweep` | `conditions.latency.value ∈ {0,10,50,100,200}` ms | `N = 100`, `D = 6`, reliability ideal | `timeToCompletionMs`, `roundsUsed` |

Unlimited capacity is deliberate: it isolates the swept variable's effect on the **protocol** from any
capacity gating (see route-existence for the capacity story). The `_note` field in each spec is a human
comment; the runner ignores unknown keys.

**Depth and the oracle run at the *same* depth.** The sim runner probes the oracle at exactly the protocol's
`maxDepth`, and — since `tallynet-discovery-depth-reach` landed — the protocol's reach is `maxDepth = L` (one
round per level), with **no depth doubling**. So the depth sweep is an apples-to-apples comparison: any gap it
showed would be real protocol loss, **not** a reach-cadence artifact. (An earlier design claimed reach was
≈ `⌊maxDepth/2⌋ + 1`; that 2× undercount was a simulator-clock bug, now fixed — see
[`../../docs/design.md`](../../docs/design.md) § "Rounds ↔ hops".) This experiment therefore compares at
matched depth and reports the result as-is, rather than budgeting `maxDepth` at 2× or labelling a cadence gap.

## Regenerating

```
./regenerate.sh          # rebuilds tallysim, runs all three specs, writes out/ + found-vs-oracle.jsonl
```

It writes per-spec `out/<name>.jsonl` and `out/<name>.csv`, then concatenates the three JSON-lines files into
**`found-vs-oracle.jsonl`** — one self-describing artifact (every record carries its generator, capacity kind,
swept coordinates and protocol metrics). The three sweeps are told apart in the combined file by which
`params` keys a record carries. The sweep is fully deterministic: `regenerate.sh` reproduces the committed
output **byte-identically** (seeded network / workload / conditions streams + the trace tier's byte-identical
guarantee). The whole grid runs in well under a minute.

## Keep the grid modest (cost ceiling)

Route discovery is **~O(network) per query** — seconds-scale, far costlier than the oracle's bounded BFS (a
`NOTE:` marks this at the sim runner's per-query loop, `src/sim/sim-runner.ts`). So this grid is kept small on
purpose: two entity counts (`N ∈ {100, 1000}`, and only `N = 100` for the sleeping/latency sweeps), two seeds,
50 queries per run. If you grow it, keep `regenerate.sh` well under ~10 minutes (agent-runnable): prefer more
seeds or finer sweep steps at small `N` over large `N` at deep `D`, and if a sweep ever needs large `N`, record
only sampled queries rather than running every pair.

## Finding

Recorded in [`../../docs/design.md`](../../docs/design.md) § Discovery simulation → *Found vs. oracle*. In
short: at matched depth the protocol finds **every** route the oracle sees (`pFoundGivenExists = 1` across all
depths and both `N`) — confirming reach `= maxDepth`, with depth showing up as pure cost (messages grow, rounds
stay a low single digit); success falls steadily as nodes sleep (≈ 1 → ≈ 0.4 by 50 % asleep) because the oracle
still counts routes through the dark relays the protocol can no longer use; and latency is pure cost —
completion time grows linearly with per-link latency while `pFoundGivenExists` stays 1 and `roundsUsed` stays
flat (rounds are depth-bound, not latency-bound).
