#!/usr/bin/env bash
set -euo pipefail
# Increment android versionCode (Android refuses to install a lower code over a higher one, and a
# browser-download reinstall of the same code is unreliable). Run before each shipped build;
# yarn ship:apk does. versionName is left alone: change it by hand when it means something.
cd "$(dirname "$0")/.."
G=android/app/build.gradle
cur=$(sed -n 's/^ *versionCode \([0-9]*\).*/\1/p' "$G" | head -1)
[ -n "$cur" ] || { echo "ERROR: no versionCode in $G" >&2; exit 1; }
next=$((cur + 1))
sed -i '' "s/^\( *versionCode \)${cur}$/\1${next}/" "$G"
echo "versionCode $cur -> $next ($G)"
