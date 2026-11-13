#!/bin/bash
# Rebuilds game.bundle.js after editing anything in js/ (only needs python3 + Pillow).
set -e
cd "$(dirname "$0")"
python3 tools/embed_photos.py
python3 tools/bundle.py
python3 tools/make_artifact.py
