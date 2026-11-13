#!/bin/bash
# Double-click to play MAX IV Explorer (starts a tiny local web server and opens the browser)
cd "$(dirname "$0")"
(sleep 1; open "http://localhost:8642/") &
python3 -m http.server 8642
