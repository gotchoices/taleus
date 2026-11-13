#!/usr/bin/env sh
# Run Metro, and start it again whenever it exits (killed, crashed or stopped). Each start rebuilds
# the workspace packages the app bundles (`model:build`: taleus-core, taleus-model, taleus-sereus),
# a quick no-op when nothing changed, so killing Metro also picks up their edits. Ctrl-C in this
# window ends the loop.
#
#   yarn metro_loop            the project's Metro port (env-defaults.sh / .env.ports.local)
#
# A start runs with --reset-cache when the flag file tmp/metro-reset-cache exists, then deletes it:
# `yarn metro_restart --reset-cache` sets the flag and kills the running Metro, so an agent can get a
# fresh, cache-clean Metro without starting one itself. The port is fixed; while the old Metro still
# holds it, the new one fails and is retried a second later.
set -u
cd "$(dirname "$0")/.." || exit 1
. ./env-defaults.sh

flag=tmp/metro-reset-cache
stop=0
trap 'stop=1' INT TERM

while [ "$stop" -eq 0 ]; do
	reset=''
	if [ -e "$flag" ]; then
		rm -f "$flag"
		reset='--reset-cache'
	fi
	echo "metro_loop: starting Metro on port $METRO_PORT${reset:+ with $reset} ($(date '+%H:%M:%S'))"
	if yarn model:build; then
		# shellcheck disable=SC2086 # $reset is empty or one flag
		react-native start --port "$METRO_PORT" $reset
		status=$?
	else
		status=$?
		echo "metro_loop: the workspace packages failed to build; fix them and the loop retries."
		sleep 2
	fi
	[ "$stop" -ne 0 ] && break
	echo "metro_loop: Metro exited ($status); restarting in 1s. Ctrl-C to stop."
	sleep 1
done
echo "metro_loop: stopped."
