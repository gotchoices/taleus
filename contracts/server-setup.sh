#!/usr/bin/env bash
set -euo pipefail

# One-time setup of sereus.org's shared Stroc document server. Safe to re-run: it creates what is
# missing and (re)starts the container, and never touches documents already published.
#
# Usage:
#   ./server-setup.sh [USER@HOST] [DOCS_ROOT] [STROC_SRC]
# Defaults:
#   HOST: gotchoices.org, PUBLISH_USER: root
#   DOCS_ROOT: /srv/stroc/sereus.org   (the shared document folder every app publishes into)
#   STROC_SRC: /srv/stroc/src          (a checkout of github.com/gotchoices/stroc, built into the image)
#
# The HTTPS front end then forwards only Stroc's paths to 127.0.0.1:3100 (README.md shows nginx and
# Caddy). This script does not edit the front end's configuration.

HOST_ARG="${1:-gotchoices.org}"
if [[ "$HOST_ARG" == *"@"* ]]; then
	REMOTE="$HOST_ARG"
else
	REMOTE="${PUBLISH_USER:-root}@${HOST_ARG}"
fi
DOCS_ROOT="${2:-/srv/stroc/sereus.org}"
STROC_SRC="${3:-/srv/stroc/src}"

ssh "$REMOTE" "bash -s" -- "$DOCS_ROOT" "$STROC_SRC" <<'SH'
set -euo pipefail
DOCS_ROOT="$1"; STROC_SRC="$2"

mkdir -p "$DOCS_ROOT/.stroc-archive"
if [[ ! -f "$DOCS_ROOT/.stroc.yaml" ]]; then
	cat > "$DOCS_ROOT/.stroc.yaml" <<'YAML'
# sereus.org's Stroc catalog configuration, shared by every app that publishes here.
# endorse: CIDs of documents by other authors that sereus.org recommends.
# withdrawn: CIDs sereus.org no longer recommends (they stay served).
domain: sereus.org
endorse: []
withdrawn: []
YAML
	echo "created $DOCS_ROOT/.stroc.yaml"
fi
# The container runs as `node` (uid 1000) and only reads the folder.
chmod -R a+rX "$DOCS_ROOT"

if [[ -d "$STROC_SRC/.git" ]]; then
	git -C "$STROC_SRC" pull --ff-only
else
	git clone https://github.com/gotchoices/stroc.git "$STROC_SRC"
fi
docker build -t stroc-server "$STROC_SRC"
docker rm -f stroc-server >/dev/null 2>&1 || true
docker run -d --name stroc-server --restart unless-stopped -p 127.0.0.1:3100:3000 \
	-v "$DOCS_ROOT:/documents:ro" -e STROC_DOMAIN=sereus.org stroc-server
sleep 2
curl -sf http://127.0.0.1:3100/.well-known/stroc/catalog.json | head -c 300; echo
SH
