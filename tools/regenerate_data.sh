#!/bin/bash
# Regenerate all scattering data with the latest DebyeCalculator, then rebuild the game.
# The browser cannot run DebyeCalculator (Python/PyTorch), so its patterns are precomputed into js/*_data.js;
# run this after a DebyeCalculator release to bring its improvements into the game.
#
#   ./tools/regenerate_data.sh          latest release from PyPI
#   ./tools/regenerate_data.sh --git    newest code on GitHub main
#
# Uses a local virtual environment (.venv-debye) that reuses PyTorch/ASE if they are already installed.
# DebyeCalculator: Johansen, Anker et al., J. Open Source Softw. 2024, 9(94), 6024, doi:10.21105/joss.06024
set -euo pipefail
cd "$(dirname "$0")/.."
VENV=.venv-debye
if [ ! -x "$VENV/bin/python" ]; then python3 -m venv --system-site-packages "$VENV"; fi
if [ "${1:-}" = "--git" ]; then SRC="git+https://github.com/FrederikLizakJohansen/DebyeCalculator"; else SRC="debyecalculator>=1.1.1"; fi
"$VENV/bin/pip" install --upgrade --quiet "$SRC" ase
"$VENV/bin/python" -c "from importlib.metadata import version; print('DebyeCalculator', version('debyecalculator'))"
for s in cosaxs_debye analysis_debye danmax_debye scatterlab_debye; do
  echo "== tools/$s.py"
  "$VENV/bin/python" "tools/$s.py"
done
./build.sh
