#!/bin/bash
set -e

cd "$(dirname $0)"

MANIFEST_DIR="$HOME/.mozilla/native-messaging-hosts"

[ "$UID" == "0" ] && MANIFEST_DIR="/usr/lib/mozilla/native-messaging-hosts"

rm -f "$MANIFEST_DIR/webext.fsa.app.json"

echo "Uninstalled."
