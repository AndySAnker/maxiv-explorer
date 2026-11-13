#!/bin/bash
# Double-click to play MAX IV Explorer: starts the game server (with multiplayer) and opens the browser
cd "$(dirname "$0")"
(sleep 1; open "http://localhost:8080/") &
if command -v node >/dev/null; then node server/server.mjs; else python3 -m http.server 8080; fi
