#!/bin/bash
set -e

cd "$(dirname $0)"

if ! (env python -c "try: import tkinter
except: import Tkinter" &>/dev/null); then
    echo "Python tkinter module not found. Canceled."
    exit 1
fi

read -p "Do you want to install to this directory (y/n)? " choice

if [ "$choice" == "y" ]; then
    echo "Installing..."
elif [ "$choice" == "n" ]; then
    echo "Canceled."
    exit 0
else
    echo "Invalid choice. Please choose y or n."
    exit 1
fi

APP_PATH="$(realpath fsa-host.py)"

/usr/bin/env -S env &> /dev/null || APP_PATH="$(realpath run.sh)"

chmod +x "$APP_PATH"

MANIFEST="$(cat ./manifest.template.json)"

MANIFEST_DIR="$HOME/.mozilla/native-messaging-hosts"

[ "$UID" == "0" ] && MANIFEST_DIR="/usr/lib/mozilla/native-messaging-hosts"

mkdir -p "$MANIFEST_DIR"

echo "${MANIFEST//\"__APP_PATH__\"/$(printf '"%s"' "${APP_PATH//\"/\\\"}")}" > "$MANIFEST_DIR/webext.fsa.app.json"

echo "Installed."
