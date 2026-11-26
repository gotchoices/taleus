description: Add two missing discovery tests — one that runs route-finding on a much larger network than we currently test, and one that searches over more than one kind of link — to close coverage gaps the ChipNet comparison turned up.
files: packages/tallynet/src/testing/discovery.test.ts, packages/tallynet/src/testing/network.ts, packages/tallynet/docs/chipnet-review.md
----

Found by the ChipNet regression check (`packages/tallynet/docs/chipnet-review.md` § Regression check, "Tests ChipNet exercises that TallyNet's don't"). Two coverage gaps — neither is a regression (TallyNet's suite otherwise exceeds ChipNet's, whose consensus tests never compiled), but both are worth closing.

## 1. Scale

ChipNet's `test/uni-discovery.test.ts` ran a **10 000-node / 70 000-link** graph (average degree ~14) — though on unseeded randomness and asserting nothing. TallyNet's largest **seeded, asserting** discovery test tops out at **1 000 nodes / 2 000 links** (`src/testing/discovery.test.ts`, the `randomGraph(SeededRandom(99))` case) — an order of magnitude fewer nodes and ~3.5× sparser.

Add a large-graph case (≈10k nodes, and a separate dense/high-degree case) that **asserts**: search completes under the virtual clock, found routes are valid chains against the merged nonce→link map, and found-vs-oracle agreement where the oracle is affordable. Confirm the `VirtualClock` macrotask drain and the step-wise BFS hold at that size and density. Keep it seeded and deterministic. Watch the wall-clock: if a 10k oracle cross-check is too slow for CI, assert completion + chain-validity only and leave the oracle to `tallysim`.

## 2. Mixed / comms intents

Discovery advertises **extensible intent codes** (`string`, not ChipNet's `'L' | 'C'`), but every discovery test uses only the single `L`/balance code. ChipNet listed mixed-intent routing as intended (`test/uni-discovery.test.ts` TODO) and never built it; TallyNet inherits the untested hole.

Add a test with at least two codes on the graph (e.g. `L` plus a second code `C`) and assert `planSatisfies`'s whole-plan semantics: a query carrying both codes concludes only on a plan whose every link carries both; a plan missing a code on some link does not satisfy. This also guards the cross-plan quirk TallyNet deliberately fixed (ChipNet could report "satisfied" when different codes were covered by different plans — see the regression table).

Note (conditional, not this ticket): the whole-path intent **trimming** ChipNet did at match nodes (rewriting every link to the code intersection) is intentionally not ported; it only matters for multi-intent/multi-denomination plans and is owned by `feat-tallynet-multi-denomination`. A mixed-intent test here should not assume trimming.

## TODO

- Large seeded graph case in `src/testing/discovery.test.ts` (+ a dense variant); assert completion + route validity (+ oracle agreement if affordable).
- Mixed-intent (`L`+`C`) case asserting whole-plan satisfaction and non-satisfaction.
- Stream any long run's output (`| tee`) so the runner's idle timer does not expire; if a case routinely exceeds ~10 min wall-clock, mark it CI-only and document the deferral.
