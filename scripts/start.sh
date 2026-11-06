#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
if [ -x ".venv/bin/python" ]; then
  exec .venv/bin/python backend/run.py
else
  exec .venv/Scripts/python backend/run.py
fi
