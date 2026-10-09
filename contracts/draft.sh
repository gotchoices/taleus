#!/usr/bin/env bash
set -euo pipefail
# Run a stroc command against this folder while it is still a draft.
#
#   ./draft.sh serve . --editor --watch     browse the composed documents
#   ./draft.sh lint *.yaml                  check them
#   ./draft.sh render Tally_Contract.yaml -o tally.pdf
#   ./draft.sh --unlink                     just put the file links back and drop the record
#
# The committed documents keep their includes as file links (source: {/: ./Clause.yaml}) so that an
# edited clause is never referenced by a stale CID. stroc's serve/render/lint/export need CIDs, and
# only `stroc link` makes them, but `stroc link` also writes .stroc-record.json and .stroc-archive/,
# which must not exist before the first publish (README.md). So: link, run the command, and on exit
# put the file links back and remove the record. publish.sh links for real.
#
# Once the set is published (.stroc-record.json is tracked by git), includes stay CIDs and the
# record stays: this script then runs stroc as-is and `stroc status` / `stroc update` take over.
cd "$(dirname "$0")"
STROC="${STROC:-yarn stroc}"

published() { git ls-files --error-unmatch .stroc-record.json >/dev/null 2>&1; }

unlink() {
	# Every include whose CID is a current file's CID becomes that file's link again.
	local map; map="$($STROC cid ./*.yaml | awk '{ print $1, $2 }')"
	while read -r cid file; do
		[ -n "$cid" ] || continue
		sed -i '' "s#source: {/: ${cid}}#source: {/: ./$(basename "$file")}#" ./*.yaml
	done <<< "$map"
	rm -rf .stroc-record.json .stroc-archive
}

if published; then
	exec $STROC "$@"
fi
if [[ "${1:-}" == "--unlink" ]]; then unlink; exit 0; fi

trap unlink EXIT
$STROC link . >/dev/null
$STROC "$@"
