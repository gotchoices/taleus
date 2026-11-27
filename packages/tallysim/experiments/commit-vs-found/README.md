# Experiment: commit vs. found

**Question.** Of the payment routes the decentralised protocol actually *finds* (the
[`found-vs-oracle/`](../found-vs-oracle/) experiment's subject), how many go on to **commit** when driven
through the real `tallynet` sign-and-settle lift — and when they don't, *why not*?

This is the tallysim **consensus** tier's first checked-in result. Where `found-vs-oracle` stops at discovery
(*did the protocol find a route?*), this one takes each found route, drives the actual promise/commit engine
over it on compressed, deterministic time, moves money on commit, and records the outcome. The headline metric
is **`pCommitGivenFound`** = P(commit | a route was found and a lift attempted) — the consensus complement of
`found-vs-oracle`'s `pFoundGivenExists`. The three outcomes are **commit** (settled, balances moved), **void**
(a participant refused, so the lift was cleanly abandoned) and **pending** (the lift *stalled* — a needed
message was lost, and the recovery loop that now runs on every stall could reach no settled evidence to pull,
so it abandoned and the lift stays hanging).

## Specs (`specs/*.json`)

Two committed consensus-sweep specs (`SimSweepSpec` files with a `consensus` block), each at one **fixed
mid-degree topology** — `scale-free` (Barabási–Albert), `edgesPerNode = 3` (mean degree ≈ 6), **unlimited**
capacity, 50 queries, `N = 100`, depth `D = 6`, seeds `[1, 2]` — so each sweep is one-dimensional and isolates
a single failure mode:

| spec | varies | what fails | measures |
|---|---|---|---|
| `refuser-sweep` | `consensus.refuserFraction ∈ {0,.1,.2,.3,.4,.5}` | nodes that decline to promise (→ **void**, `refused-promise`) | `pCommitGivenFound`, `voidReasons.refused-promise` |
| `drop-sweep` | `conditions.dropFraction ∈ {0,.1,.2,.3,.4,.5}` | dropped links (→ fewer routes **found**, and found routes **stall**) | `pCommitGivenFound`, `liftCount`, `voidReasons.stalled` |

Unlimited capacity is deliberate: it keeps the swept failure mode clean of any capacity gating (every found
route *could* settle on capacity grounds, so a non-commit is always a failure-injection effect, never a
depleted tally). The `_note` field in each spec is a human comment; the runner ignores unknown keys.

**Two dials, two seed streams.** `refuserFraction` is a **consensus-only** dial drawn from its own dedicated
`consensusSeed` stream, independent of the network / workload / conditions streams — so raising it never shifts
*which* routes discovery finds (confirmed below: `liftCount` stays flat at 50 across the whole refuser sweep).
`dropFraction` lives in the shared `conditions` block and so degrades **both** phases through the one per-link
condition map: a dropped link severs some discovery routes **and** drops the consensus record push across it.
See [`../../docs/design.md`](../../docs/design.md) § *Failure injection in the consensus phase*.

### The latency / code-TTL ceiling (read before adding latency)

Both specs run with **instant** delivery (no `latency`), so settle time is 0 virtual ms and no code ever
expires. If you add latency, keep it **well under the session/transaction code TTL of 600 000 ms** of virtual
time (the `VirtualClock` starts at 0; the default minting TTL is `600_000` ms — see `tallynet`'s
`InMemoryNetwork.buildLift`). A push delayed past a code's expiry makes verification reject the record, which
voids the lift with reason `expired` — a *different* outcome than the one a latency sweep means to measure. For
a `D = 6` route the deepest settle is a handful of round-trips, so any per-link latency up to a few thousand ms
is safe; it is only pathological latencies that trip the ceiling.

## Regenerating

```
./regenerate.sh          # rebuilds tallysim, runs both specs, writes out/ + commit-vs-found.jsonl
```

It writes per-spec `out/<name>.jsonl` and `out/<name>.csv`, then concatenates the two JSON-lines files into
**`commit-vs-found.jsonl`** — one self-describing artifact (every record carries its generator, capacity kind,
swept coordinates and consensus metrics). The two sweeps are told apart in the combined file by which `params`
key a record carries (`consensus.refuserFraction` vs `conditions.dropFraction`). The sweep is fully
deterministic: `regenerate.sh` reproduces the committed output **byte-identically** (seeded network / workload
/ conditions / refuser / identity streams). The whole grid runs in ≈ 2 minutes.

## Keep the grid modest (cost ceiling)

The consensus phase is **costlier than discovery alone**: it drives the real sign-and-settle lift for every
found route *and* mints a fresh ed25519 identity per node per query build (the runner rebuilds the sim per
query so each lift sees the previous commit's changed capacity — see
[`../../docs/design.md`](../../docs/design.md) § *The sequential consensus sweep runner*). So this grid is kept
small on purpose: one entity count (`N = 100`), two seeds, 50 queries, six cells per sweep — ≈ 2 minutes total,
comfortably agent-runnable (well under ~10 min). If you grow it, prefer more seeds or finer sweep steps at
small `N` over large `N`; a `NOTE:` at the runner's rebuild-per-query loop (`src/sim/consensus-runner.ts`)
marks where to cache identities across rebuilds if a large grid ever needs it.

## Finding

Recorded in [`../../docs/design.md`](../../docs/design.md) § Consensus simulation. In short, both failure modes
drive `pCommitGivenFound` down, but by **different routes through the metrics** (values averaged over seeds
`[1, 2]`):

- **Refusers void found routes — and the fall is faster than the refuser fraction.** Discovery is untouched
  (`liftCount` = 50 at every point, confirming the independent seed stream), but `pCommitGivenFound` drops
  `1.00 → 0.68 → 0.51 → 0.26 → 0.19 → 0.09` as 0 → 50 % of nodes refuse. It falls faster than linear because a
  refuser **anywhere** on a multi-hop route voids the whole lift, so a lift's survival compounds roughly as
  `(1 − fraction)^(route length)` — even 10 % refusers cost a third of all commits. **Every** non-commit is a
  clean `void` with reason `refused-promise` (no stalls, no expiries): a refusal is detected and the lift is
  abandoned in good order.

- **Dropped links cost twice: fewer routes found, and found routes stall.** As `dropFraction` climbs,
  `liftCount` (routes found) falls `50 → 49.5 → 48.5 → 45 → 38.5 → 33.5` (discovery loses relays), and of the
  routes still found a growing share **stall**: `pending` rises `0 → 3.5 → 6 → 10.5 → 13.5 → 14.5`, every one
  tallied as `voidReasons.stalled`. `pCommitGivenFound` therefore falls `1.00 → 0.93 → 0.88 → 0.77 → 0.65 →
  0.57`. The stalls are the **sleeping/dropped-target asymmetry** in action: discovery peer-matches a dark
  terminus (or crosses what later becomes a dropped needed edge) and still *finds* the route, but the consensus
  record push over that link is lost. The commit engine's recovery loop runs on every such stall, but this
  sweep publishes no contact points, so a stranded member's pull has nowhere to reach the settled evidence; the
  loop abandons past its give-up ceiling and the lift settles nowhere (`permanentlyPendingCount` matches
  `pendingCount` at every cell). No record in this sweep voids by refusal (`refused-promise` = 0) — drops
  produce only stalls and missing routes.

The headline for Taleus: a found route is **not** a committed payment. A cooperative, reliable network commits
every route it finds (`pCommitGivenFound` = 1 at zero failure injection, the correctness floor), but refusing
nodes abandon lifts *cleanly* (void) while lost messages leave them *hanging* (pending/stall). The commit
engine's recovery loop now heals a stall wherever a pull can reach the settled evidence, but a dropped link
with no reachable evidence — exactly this sweep's case, which has no contact points — still strands the lift;
the self-*re-routing* that would close that last gap (choosing an alternate path to the evidence when the
direct one is dark) is the still-deferred `tallynet-propagation-timeouts` work.
