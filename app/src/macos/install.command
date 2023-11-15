#!/bin/bash
set -e

cd "$(dirname $0)"

if ! (env python -c "try: import tkinter
except: import Tkinter" &>/dev/null); then
    echo "Python tkinter module not found. Canceled."
    exit 1
fi

echo -n "Do you want to install to this directory (y/n)? "
read choice

if [ "$choice" == "y" ]; then
    echo "Installing..."
elif [ "$choice" == "n" ]; then
    echo "Canceled."
    exit 0
else
    echo "Invalid choice. Please choose y or n."
    exit 1
fi

APP_PATH="$PWD/fsa-host.py"

/usr/bin/env -S env &> /dev/null || APP_PATH="$PWD/run.sh"

chmod +x "$APP_PATH"

MANIFEST="$(cat ./manifest.template.json)"

MANIFEST_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"

[ "$UID" == "0" ] && MANIFEST_DIR="/Library/Application Support/Mozilla/NativeMessagingHosts"

mkdir -p "$MANIFEST_DIR"

echo "${MANIFEST//\"__APP_PATH__\"/$(printf '"%s"' "${APP_PATH//\"/\\\"}")}" > "$MANIFEST_DIR/webext.fsa.app.json"

echo "Installed."
