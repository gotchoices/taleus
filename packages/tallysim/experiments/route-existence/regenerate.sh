#!/usr/bin/env bash
#
# Regenerate the checked-in route-existence experiment data from the committed sweep specs.
#
# It (re)builds tallysim, runs each sweep spec through the Node CLI (writing per-spec JSON-lines + CSV into
# out/), then concatenates the four JSON-lines files into one self-describing artifact, route-existence.jsonl.
# Every record carries its generator, capacity kind, varied coordinates and metrics, so the combined file is
# readable on its own. The sweep is fully deterministic: the same specs reproduce byte-identical output.
#
# Runs in a few seconds total. The per-spec commands write to files; progress is echoed between them so the
# output stream never goes silent (wrap this script in `| tee` if you want a log).
#
# Usage: experiments/route-existence/regenerate.sh

set -euo pipefail

EXP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$EXP_DIR/../.." && pwd)"

# Spec order is fixed so the combined route-existence.jsonl is byte-stable run to run.
SPECS=(uniform-unlimited uniform-realistic scalefree-unlimited scalefree-realistic)

cd "$PKG_DIR"
echo "[regenerate] building tallysim (CLI needs dist/) ..."
yarn build

mkdir -p "$EXP_DIR/out"
for name in "${SPECS[@]}"; do
	echo "[regenerate] sweep: $name"
	node dist/cli/sweep.js "$EXP_DIR/specs/$name.json" \
		--jsonl "$EXP_DIR/out/$name.jsonl" \
		--csv "$EXP_DIR/out/$name.csv"
done

echo "[regenerate] combining into route-existence.jsonl"
: >"$EXP_DIR/route-existence.jsonl"
for name in "${SPECS[@]}"; do
	cat "$EXP_DIR/out/$name.jsonl" >>"$EXP_DIR/route-existence.jsonl"
done

echo "[regenerate] done — $(wc -l <"$EXP_DIR/route-existence.jsonl") records in route-existence.jsonl"
