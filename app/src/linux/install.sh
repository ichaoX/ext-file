#!/bin/bash

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

[ -d ~/.mozilla/native-messaging-hosts/ ] || mkdir -p ~/.mozilla/native-messaging-hosts/

echo "${MANIFEST//\"__APP_PATH__\"/$(printf '"%s"' "${APP_PATH//\"/\\\"}")}" > ~/.mozilla/native-messaging-hosts/webext.fsa.app.json
