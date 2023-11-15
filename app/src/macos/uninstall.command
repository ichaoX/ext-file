#!/bin/bash
set -e

cd "$(dirname $0)"

MANIFEST_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"

[ "$UID" == "0" ] && MANIFEST_DIR="/Library/Application Support/Mozilla/NativeMessagingHosts"

rm -f "$MANIFEST_DIR/webext.fsa.app.json"

echo "Uninstalled."
