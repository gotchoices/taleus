#!/usr/bin/env sh
set -eu

# Publish the mobile scenario storyboards to the web.
#
#   yarn publish:scenarios                 deploy to $SCENARIOS_DEST
#   yarn publish:scenarios --dry-run       render only; print the rsync it would run
#
# Destination comes from env-defaults.sh (override in .env.ports.local), and is a
# directory of its own under the taleus page — see below.
#
# Three things this adds over calling appeus directly:
#
#  1. A clean build. The renderer writes into site/ without clearing it, so a
#     scenario or image that was deleted upstream lingers there and gets
#     published. Removing the directory first means what ships is what exists.
#  2. The remote directory. appeus does not create it; the first rsync to a
#     missing path fails.
#  3. A guard on the destination. The publish is `rsync --delete`. Pointed at
#     .../taleus it would delete index.html, invite.html, styles.css, images and
#     the APK that web/publish.sh puts there.

cd "$(dirname "$0")/.."
. ./env-defaults.sh

APP_DIR="$(pwd)"
PROJECT_DIR="$(cd ../.. && pwd)"
SITE_DIR="$PROJECT_DIR/design/generated/mobile/site"
APPEUS="$PROJECT_DIR/appeus/scripts/publish-scenarios.sh"

DRY_RUN=0
for arg in "$@"; do
  [ "$arg" = "--dry-run" ] && DRY_RUN=1
done

# The destination must be a leaf of taleus's own, never the page root.
case "${SCENARIOS_DEST##*:}" in
  */taleus) echo "Refusing: SCENARIOS_DEST is the taleus page root, and this publish deletes." >&2
            echo "  It would remove index.html, invite.html, styles.css, images/ and the APK." >&2
            echo "  Use a subdirectory, e.g. ${SCENARIOS_DEST}/preview" >&2
            exit 2 ;;
  */) echo "Refusing: SCENARIOS_DEST ends in a slash; give a directory path." >&2; exit 2 ;;
esac

echo "Clean build: removing $SITE_DIR"
rm -rf "$SITE_DIR"

if [ "$DRY_RUN" -eq 1 ]; then
  exec "$APPEUS" --target mobile --dest "$SCENARIOS_DEST" --dry-run
fi

REMOTE="${SCENARIOS_DEST%%:*}"
REMOTE_PATH="${SCENARIOS_DEST#*:}"
echo "Ensuring $REMOTE:$REMOTE_PATH exists"
ssh "$REMOTE" "mkdir -p '$REMOTE_PATH'"

"$APPEUS" --target mobile --dest "$SCENARIOS_DEST"

cd "$APP_DIR"
echo
echo "Published. If the page is at https://sereus.org/taleus/, the storyboards are at"
echo "  https://sereus.org/taleus/preview/  (appeus lays out scenarios/ and states.html beneath it)"
echo
echo "Note: web/publish.sh rsyncs web/ with --delete; it excludes preview/ so this survives it."
