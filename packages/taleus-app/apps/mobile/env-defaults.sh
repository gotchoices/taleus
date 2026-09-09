#!/bin/sh
# env-defaults.sh — per-project, override-friendly emulator/Metro settings.
#
# SOURCE this (don't execute it) so the vars carry into the calling shell —
# the package.json scripts do exactly that, e.g.:
#     . ./env-defaults.sh && react-native start --port "$METRO_PORT"
#
# Precedence, lowest to highest:
#   1. the defaults below                    — applied only when the var is unset/empty
#   2. values already in the environment      — kept, because ${VAR:=default} won't clobber them
#   3. .env.ports.local at the project root   — git-ignored; sourced last, so it wins over both
#
# The defaults below are the stock React Native / Android ones, so a fresh clone
# just works. Running this project alongside another (e.g. ser/chat, ser/health)
# is what .env.ports.local is for — put the divergent ports there, not here.
#
# When choosing an emulator port: the console port must be EVEN and in 5554..5682;
# the odd port right above it is the paired adb port (so emulator-5554 speaks adb
# on 5555). 5555 is therefore not a legal console port — step by twos.

# (1) + (2): defaults that yield to anything already exported.
: "${METRO_PORT:=8081}"
: "${EMULATOR_PORT:=5554}"
: "${DEVICE_SERIAL:=emulator-5554}"
: "${AVD_NAME:=Pixel_A}"
# The appeus scenario previewer. It binds a port and drives one device, so both
# belong here for the same reason the Metro port does: two projects previewing at
# once must not collide, and links must open on this project's emulator.
: "${PREVIEW_PORT:=8080}"

# Where published scenarios land. Same host and docroot as web/publish.sh, in a
# directory of taleus's own: the publish is an `rsync --delete`, so it must never
# be pointed at a directory that holds anything it did not put there.
: "${PUBLISH_USER:=root}"
: "${PUBLISH_HOST:=gotchoices.org}"
: "${SEREUS_ROOT:=/var/www/sereus.org}"
: "${SCENARIOS_DEST:=${PUBLISH_USER}@${PUBLISH_HOST}:${SEREUS_ROOT}/taleus/scenarios}"

# (3): project-local overrides, not committed. Sourced from the project root
# (the package.json scripts run there). The leading "./" is required: POSIX `.`
# searches PATH for a bare name, so `. ./.env.ports.local` sources the local file.
if [ -f ./.env.ports.local ]; then
  . ./.env.ports.local
fi

export METRO_PORT EMULATOR_PORT DEVICE_SERIAL AVD_NAME PREVIEW_PORT
export PUBLISH_USER PUBLISH_HOST SEREUS_ROOT SCENARIOS_DEST
