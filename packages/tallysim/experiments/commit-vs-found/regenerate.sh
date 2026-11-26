#!/usr/bin/env bash
#
# Regenerate the checked-in commit-vs-found experiment data from the committed sweep specs.
#
# It (re)builds tallysim, runs each consensus sweep spec through the Node `consensus` CLI (writing per-spec
# JSON-lines + CSV into out/), then concatenates the two JSON-lines files into one self-describing artifact,
# commit-vs-found.jsonl. Every record carries its generator, capacity kind, swept coordinates (keyed by their
# vary path) and consensus metrics, so the combined file is readable on its own — the two sweeps are told
# apart by which `params` key a record carries (consensus.refuserFraction vs conditions.dropFraction).
#
# The sweep is fully deterministic (seeded network / workload / conditions / refuser / identity streams): the
# same specs reproduce byte-identical output. Runs in ~2 minutes total — the consensus phase drives the real
# sign-and-settle lift for every found route and mints a fresh ed25519 identity per node per query build, so
# it is costlier than the discovery-only found-vs-oracle sweep; the grid is kept deliberately small (see
# ../README.md § Keep the grid modest). The per-spec commands write to files; progress is echoed between them
# so the output stream never goes silent (wrap this script in `| tee` if you want a log).
#
# Usage: experiments/commit-vs-found/regenerate.sh

set -euo pipefail

EXP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$EXP_DIR/../.." && pwd)"

# Spec order is fixed so the combined commit-vs-found.jsonl is byte-stable run to run.
SPECS=(refuser-sweep drop-sweep)

cd "$PKG_DIR"
echo "[regenerate] building tallysim (CLI needs dist/) ..."
yarn build

mkdir -p "$EXP_DIR/out"
for name in "${SPECS[@]}"; do
	echo "[regenerate] consensus sweep: $name"
	node dist/cli/consensus.js "$EXP_DIR/specs/$name.json" \
		--jsonl "$EXP_DIR/out/$name.jsonl" \
		--csv "$EXP_DIR/out/$name.csv"
done

echo "[regenerate] combining into commit-vs-found.jsonl"
: >"$EXP_DIR/commit-vs-found.jsonl"
for name in "${SPECS[@]}"; do
	cat "$EXP_DIR/out/$name.jsonl" >>"$EXP_DIR/commit-vs-found.jsonl"
done

echo "[regenerate] done — $(wc -l <"$EXP_DIR/commit-vs-found.jsonl") records in commit-vs-found.jsonl"
