#!/usr/bin/env bash
# Run scenario files again and again in each strand mode and count what passed: the check to run
# before adopting a new stack, since some stack faults show only once in several runs.
#
#   yarn scenarios:loop                         3 runs each of online and offline, every scenario file
#   yarn scenarios:loop 5 offline               5 offline runs
#   yarn scenarios:loop 3 "online offline" scenarios/stack.scenario.ts
#
# Every TALEUS_SCENARIO_* setting passes through (e.g. TALEUS_SCENARIO_HOME for the party folders).
# Each run's output goes to a log under SCENARIO_LOOP_LOGS (default: a fresh temp dir); a failing
# run's log is kept and named, a passing one deleted. Exits non-zero when any run failed.
set -u
cd "$(dirname "$0")/.." || exit 1

runs=${1:-3}
modes=${2:-online offline}
files=${3:-scenarios/**/*.scenario.ts}
case "$runs" in (*[!0-9]*|'') echo "usage: yarn scenarios:loop [runs] [modes] [files]" >&2; exit 2 ;; esac
logs=${SCENARIO_LOOP_LOGS:-$(mktemp -d "${TMPDIR:-/tmp}/taleus-scenario-loop-XXXXXX")}
mkdir -p "$logs"

failed=0
summary=''
for mode in $modes; do
	case "$mode" in
		online) offline=0 ;;
		offline) offline=1 ;;
		*) echo "scenario-loop: modes are 'online' and 'offline', not '$mode'" >&2; exit 2 ;;
	esac
	passed=0
	for run in $(seq 1 "$runs"); do
		log="$logs/$mode-$run.log"
		started=$(date +%s)
		TALEUS_SCENARIO_OFFLINE=$offline node --test --test-concurrency=1 "$files" > "$log" 2>&1
		status=$?
		took=$(( $(date +%s) - started ))
		if [ "$status" -eq 0 ]; then
			passed=$((passed + 1))
			rm -f "$log"
			echo "scenario-loop: $mode run $run passed (${took}s)"
		else
			failed=$((failed + 1))
			echo "scenario-loop: $mode run $run FAILED (${took}s): $(grep -m1 -E '^✖ ' "$log" | cut -c1-120) — $log"
		fi
	done
	summary="$summary $mode $passed/$runs;"
done
echo "scenario-loop:$summary logs in $logs"
[ "$failed" -eq 0 ]
