#!/bin/bash
set -e

cd "$(dirname $0)"

env python -u ./fsa-host.py
