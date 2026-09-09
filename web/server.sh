#!/usr/bin/env bash
set -euo pipefail
# Preview the site locally, mirroring the production /taleus path so the absolute
# /taleus/... asset links resolve.  Served at http://localhost:8080/taleus/
#
# Note: http.server does no URL rewriting, so /taleus/invite/<token> won't resolve
# locally — open /taleus/invite.html directly to preview the invitation page.
# Production rewrites /taleus/invite/* → /taleus/invite.html (see README.md).
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${1:-8080}"

STAGE="$(mktemp -d)"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT
ln -s "$ROOT_DIR" "$STAGE/taleus"

echo "Serving $ROOT_DIR at http://localhost:${PORT}/taleus/  (Ctrl-C to stop)"
echo "  landing: http://localhost:${PORT}/taleus/"
echo "  invite:  http://localhost:${PORT}/taleus/invite.html?token=DEMO"
cd "$STAGE"
exec python3 -m http.server "$PORT"
