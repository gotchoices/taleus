#!/usr/bin/env sh
# Restart the Metro that `yarn metro_loop` runs: kill the process listening on the Metro port and
# wait for the loop to bring a new one up. It never starts Metro itself.
#
#   yarn metro_restart                 restart
#   yarn metro_restart --reset-cache   restart once with --reset-cache (after a dependency change)
#
# Fails, saying so, when nothing listens on the port (no loop running), or when no Metro answers
# within the wait (METRO_RESTART_WAIT_S, default 180: the loop rebuilds the packages first).
set -u
cd "$(dirname "$0")/.." || exit 1
. ./env-defaults.sh

case "${1:-}" in
	--reset-cache) mkdir -p tmp && touch tmp/metro-reset-cache ;;
	'') ;;
	*) echo "usage: yarn metro_restart [--reset-cache]" >&2; exit 2 ;;
esac

pids=$(lsof -tiTCP:"$METRO_PORT" -sTCP:LISTEN 2>/dev/null)
if [ -z "$pids" ]; then
	echo "metro_restart: nothing listens on port $METRO_PORT; start 'yarn metro_loop' in a terminal first." >&2
	exit 1
fi
echo "metro_restart: stopping Metro on port $METRO_PORT (pid $pids)"
# shellcheck disable=SC2086 # one or more pids
kill $pids

# Wait for the old one to let go of the port, then for the loop's new one to answer.
waited=0
limit=${METRO_RESTART_WAIT_S:-180}
while lsof -tiTCP:"$METRO_PORT" -sTCP:LISTEN 2>/dev/null | grep -qx "$(echo "$pids" | head -1)"; do
	sleep 1; waited=$((waited + 1))
	[ "$waited" -ge 15 ] && { echo "metro_restart: Metro (pid $pids) did not stop" >&2; exit 1; }
done
until curl -s -m 2 "http://localhost:$METRO_PORT/status" | grep -q 'packager-status:running'; do
	sleep 1; waited=$((waited + 1))
	if [ "$waited" -ge "$limit" ]; then
		echo "metro_restart: no Metro answered on port $METRO_PORT after ${limit}s; is 'yarn metro_loop' running?" >&2
		exit 1
	fi
done
echo "metro_restart: Metro is up on port $METRO_PORT after ${waited}s"
