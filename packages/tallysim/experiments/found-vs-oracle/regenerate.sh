#!/usr/bin/env bash
#
# Regenerate the checked-in found-vs-oracle experiment data from the committed sweep specs.
#
# It (re)builds tallysim, runs each discovery sweep spec through the Node `simulate` CLI (writing per-spec
# JSON-lines + CSV into out/), then concatenates the three JSON-lines files into one self-describing
# artifact, found-vs-oracle.jsonl. Every record carries its generator, capacity kind, swept coordinates
# (keyed by their vary path) and protocol metrics, so the combined file is readable on its own — the three
# sweeps are told apart by which `params` keys a record carries (workload.depth + network.params.entityCount,
# conditions.sleepingFraction, or conditions.latency.value).
#
# The sweep is fully deterministic (seeded streams + the trace tier's byte-identical guarantee): the same
# specs reproduce byte-identical output. Runs in well under a minute total — the discovery protocol is
# seconds-scale, far costlier than the oracle's BFS, so the grid is kept deliberately small (see ../README.md
# § Keep the grid modest). The per-spec commands write to files; progress is echoed between them so the
# output stream never goes silent (wrap this script in `| tee` if you want a log).
#
# Usage: experiments/found-vs-oracle/regenerate.sh

set -euo pipefail

EXP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$EXP_DIR/../.." && pwd)"

# Spec order is fixed so the combined found-vs-oracle.jsonl is byte-stable run to run.
SPECS=(depth-sweep sleeping-sweep latency-sweep)

cd "$PKG_DIR"
echo "[regenerate] building tallysim (CLI needs dist/) ..."
yarn build

mkdir -p "$EXP_DIR/out"
for name in "${SPECS[@]}"; do
	echo "[regenerate] sim sweep: $name"
	node dist/cli/simulate.js "$EXP_DIR/specs/$name.json" \
		--jsonl "$EXP_DIR/out/$name.jsonl" \
		--csv "$EXP_DIR/out/$name.csv"
done

echo "[regenerate] combining into found-vs-oracle.jsonl"
: >"$EXP_DIR/found-vs-oracle.jsonl"
for name in "${SPECS[@]}"; do
	cat "$EXP_DIR/out/$name.jsonl" >>"$EXP_DIR/found-vs-oracle.jsonl"
done

echo "[regenerate] done — $(wc -l <"$EXP_DIR/found-vs-oracle.jsonl") records in found-vs-oracle.jsonl"
