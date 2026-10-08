#!/usr/bin/env bash
set -euo pipefail

# Publish Taleus's contract documents into sereus.org's shared Stroc document folder, served at
# https://sereus.org/ipfs/<cid> with the catalog at https://sereus.org/.well-known/stroc/catalog.json.
#
# Usage:
#   ./publish.sh [--dry-run] [USER@HOST] [DOCS_ROOT]
#   USER=myuser ./publish.sh [HOST] [DOCS_ROOT]
# Defaults:
#   HOST: gotchoices.org          (the host that serves sereus.org)
#   USER: root
#   DOCS_ROOT: /srv/stroc/sereus.org   (the folder the Stroc server serves; see README.md)
# Environment:
#   STROC          the stroc command (default: yarn stroc, the repo's @stroc/cli)
#   STROC_RELOAD   run on the host after publishing (default: reload a container named stroc-server)
#
# The server folder is SHARED by every Sereus app that publishes documents for sereus.org, and a
# published version must never disappear (signed tallies name it by CID forever). So:
#   1. Current documents go up as `taleus.<file>`. Only files with that prefix are ever replaced or
#      removed, so other apps' documents are untouched.
#   2. Archived versions (.stroc-archive/<cid>.json) are added, never overwritten or deleted. A
#      document dropped from this folder therefore stays served, as superseded.
#   3. The server's .stroc.yaml (domain, endorse, withdrawn) is the domain's, edited on the server.

APP=taleus
DRY_RUN=()
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=(--dry-run); shift; fi

HOST_ARG="${1:-gotchoices.org}"
if [[ "$HOST_ARG" == *"@"* ]]; then
	REMOTE="$HOST_ARG"
else
	REMOTE="${USER:-root}@${HOST_ARG}"
fi
DOCS_ROOT="${2:-/srv/stroc/sereus.org}"
RELOAD="${STROC_RELOAD:-docker kill -s HUP stroc-server >/dev/null}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
read -ra STROC_CMD <<< "${STROC:-yarn stroc}"

stroc() { "${STROC_CMD[@]}" "$@"; }

# ── 1. Check: every document valid, every include current, every current version archived ─────
# `stroc status` archives the current version of every file, so after it runs the archive holds
# everything this publish makes current.
cd "$ROOT_DIR"
shopt -s nullglob
DOCS=(*.yaml *.yml *.json)
if (( ${#DOCS[@]} == 0 )); then
	echo "ERROR: no documents in $ROOT_DIR" >&2
	exit 1
fi
echo "Checking ${#DOCS[@]} documents ..."
stroc link .            # committed drafts hold file links (see draft.sh); publishing fixes the CIDs
stroc lint "${DOCS[@]}"
if ! stroc status . ; then
	echo "ERROR: outdated includes; run 'stroc update . --all' and review before publishing." >&2
	exit 1
fi
if grep -L '^author: sereus\.org$' "${DOCS[@]}" | grep -q .; then
	echo "Note: these documents do not name sereus.org as author; the catalog lists them as hosted only:"
	grep -L '^author: sereus\.org$' "${DOCS[@]}" | sed 's/^/  /'
fi

# ── 2. Stage current documents under the app prefix ──────────────────────────────────────────
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
for doc in "${DOCS[@]}"; do
	cp "$doc" "$STAGE/$APP.$doc"
done

# ── 3. Upload ─────────────────────────────────────────────────────────────────────────────
echo "Publishing to ${REMOTE}:${DOCS_ROOT} ..."
ssh "$REMOTE" "mkdir -p '$DOCS_ROOT/.stroc-archive' && test -f '$DOCS_ROOT/.stroc.yaml'" || {
	echo "ERROR: $DOCS_ROOT/.stroc.yaml is missing on the host; set the server up first (README.md)." >&2
	exit 1
}
# Scoped --delete: excluded names are never deleted, so only this app's prefixed files can go.
rsync -av "${DRY_RUN[@]}" --delete --include="/$APP.*" --exclude='*' "$STAGE/" "$REMOTE:$DOCS_ROOT/"
rsync -av "${DRY_RUN[@]}" --ignore-existing "$ROOT_DIR/.stroc-archive/" "$REMOTE:$DOCS_ROOT/.stroc-archive/"

if (( ${#DRY_RUN[@]} )); then
	echo "Dry run: nothing changed."
	exit 0
fi

# ── 4. Reload ─────────────────────────────────────────────────────────────────────────────
if ! ssh "$REMOTE" "$RELOAD"; then
	echo "WARNING: reload failed ($RELOAD); restart the Stroc server by hand." >&2
fi

echo
echo "Publish complete. Verify:"
echo "  https://sereus.org/.well-known/stroc/catalog.json"
stroc cid "${DOCS[@]}" | sed 's|^\([^ ]*\) .*|  https://sereus.org/ipfs/\1|' | head -3
