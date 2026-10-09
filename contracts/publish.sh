#!/usr/bin/env bash
set -euo pipefail

# Publish Taleus's contract documents to sereus.org as static files: `stroc export` writes what the
# Stroc server would serve, and only its ipfs/ and .well-known/stroc/ trees are copied into the
# site's existing Apache document root. Served at https://sereus.org/ipfs/<cid>, with the catalog at
# https://sereus.org/.well-known/stroc/catalog.json.
#
# Usage:
#   ./publish.sh [--dry-run] [USER@HOST] [WEB_ROOT]
#   PUBLISH_USER=myuser ./publish.sh [HOST] [WEB_ROOT]
# Defaults:
#   HOST: gotchoices.org          (the host that serves sereus.org)
#   PUBLISH_USER: root            (not $USER, which the shell always sets to the local login)
#   WEB_ROOT: /var/www/sereus.org (Apache document root of sereus.org)
# Environment:
#   STROC   the stroc command (default: yarn stroc, the repo's @stroc/cli)
#
# A published version must never disappear (signed tallies name it by CID forever), so nothing here
# deletes on the host: ipfs/<cid> files only ever accumulate, and the export itself refuses to
# overwrite a CID file with different bytes. The catalog is rebuilt from this folder's current
# documents and its archive, so after the first publish .stroc-record.json and .stroc-archive/ must
# be committed (README.md): they are what makes an old version "superseded" rather than forgotten.

DRY_RUN=()
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=(--dry-run); shift; fi

HOST_ARG="${1:-gotchoices.org}"
if [[ "$HOST_ARG" == *"@"* ]]; then
	REMOTE="$HOST_ARG"
else
	REMOTE="${PUBLISH_USER:-root}@${HOST_ARG}"
fi
WEB_ROOT="${2:-/var/www/sereus.org}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
read -ra STROC_CMD <<< "${STROC:-yarn stroc}"

stroc() { "${STROC_CMD[@]}" "$@"; }

cd "$ROOT_DIR"
shopt -s nullglob
DOCS=(*.yaml *.yml *.json)
if (( ${#DOCS[@]} == 0 )); then
	echo "ERROR: no documents in $ROOT_DIR" >&2
	exit 1
fi

# ── 1. Check: every include a current CID, every document valid, every version recorded ────────
# Drafts hold includes as file links (draft.sh); `stroc link` fixes them as CIDs. `stroc status`
# records every current version in .stroc-record.json / .stroc-archive/, which the export reads.
echo "Checking ${#DOCS[@]} documents ..."
stroc link .
stroc lint "${DOCS[@]}"
if ! stroc status . ; then
	echo "ERROR: outdated includes; run 'stroc update . --all' and review before publishing." >&2
	exit 1
fi
if grep -L '^author: sereus\.org$' "${DOCS[@]}" | grep -q .; then
	echo "Note: these documents do not name sereus.org as author; the catalog lists them as hosted only:"
	grep -L '^author: sereus\.org$' "${DOCS[@]}" | sed 's/^/  /'
fi

# ── 2. Export the static site ────────────────────────────────────────────────────────────────
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
stroc export . -o "$STAGE/site"

# ── 3. Upload ipfs/ and .well-known/stroc/ only ──────────────────────────────────────────────
# Not index.html, _headers or .nojekyll: sereus.org has its own index, and Apache uses the
# exported .htaccess files instead. No --delete anywhere: published CIDs stay forever.
echo "Publishing to ${REMOTE}:${WEB_ROOT} ..."
ssh "$REMOTE" "test -d '$WEB_ROOT'" || {
	echo "ERROR: $WEB_ROOT is not a directory on the host." >&2
	exit 1
}
rsync -a ${DRY_RUN[@]+"${DRY_RUN[@]}"} "$STAGE/site/ipfs/" "$REMOTE:$WEB_ROOT/ipfs/"
rsync -a ${DRY_RUN[@]+"${DRY_RUN[@]}"} "$STAGE/site/.well-known/stroc/" "$REMOTE:$WEB_ROOT/.well-known/stroc/"

if (( ${#DRY_RUN[@]} )); then
	echo "Dry run: nothing changed on the host."
	if ! git ls-files --error-unmatch .stroc-record.json >/dev/null 2>&1; then
		./draft.sh --unlink     # still a draft: back to file links, no record
	fi
	exit 0
fi

echo
echo "Publish complete. Commit .stroc-record.json and .stroc-archive/ now (they list what is published)."
echo "Verify (the catalog must send Access-Control-Allow-Origin: *; see README.md for the Apache side):"
echo "  curl -sI https://sereus.org/.well-known/stroc/catalog.json | grep -i -e '^HTTP' -e access-control"
stroc cid "${DOCS[@]}" | sed 's|^\([^ ]*\) .*|  https://sereus.org/ipfs/\1|' | head -3
