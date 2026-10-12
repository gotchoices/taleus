#!/usr/bin/env bash
set -euo pipefail
# Print the release keystore's SHA-256 fingerprint and, with --write, add it to
# web/.well-known/assetlinks.json so https://sereus.org/taleus/invite/* links open a release build
# (App Links verify the installed APK's signing key against that file; the debug key is already
# listed). Then run web/publish.sh. Needs the same env as the build: STORE_FILE_TALEUS,
# STORE_PASSWORD_TALEUS, optional KEY_ALIAS_TALEUS.
cd "$(dirname "$0")/.."
: "${STORE_FILE_TALEUS:?set STORE_FILE_TALEUS to the release keystore path}"
: "${STORE_PASSWORD_TALEUS:?set STORE_PASSWORD_TALEUS}"
ALIAS="${KEY_ALIAS_TALEUS:-org.sereus.taleus}"
FP=$( { keytool -list -v -keystore "$STORE_FILE_TALEUS" -storepass "$STORE_PASSWORD_TALEUS" -alias "$ALIAS" 2>/dev/null || true; } \
	| sed -n 's/^[[:space:]]*SHA256: *//p' | head -1)
[ -n "$FP" ] || { echo "ERROR: no SHA256 for alias '$ALIAS' in $STORE_FILE_TALEUS (wrong alias or password?)" >&2; exit 1; }
echo "$FP"
if [[ "${1:-}" == "--write" ]]; then
	FP="$FP" python3 - <<'PY'
import json, os
p = '../../../../web/.well-known/assetlinks.json'
fp = os.environ['FP']
d = json.load(open(p))
for s in d:
    if s.get('target', {}).get('package_name') == 'org.sereus.taleus':
        fps = s['target'].setdefault('sha256_cert_fingerprints', [])
        if fp in fps:
            print(f'already in {p}')
        else:
            fps.append(fp); json.dump(d, open(p, 'w'), indent=2); open(p, 'a').write('\n')
            print(f'added to {p}; now run web/publish.sh')
        break
else:
    raise SystemExit(f'no org.sereus.taleus statement in {p}')
PY
fi
