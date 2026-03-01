#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate

echo "Installing dependencies..."
pip install -q -r requirements.txt

echo "Verifying pyspiel..."
python3 -c "import pyspiel; print(f'pyspiel {pyspiel.__version__} OK')"

echo "Verifying game registration..."
python3 -c "
import imposter_zero.game
import pyspiel
game = pyspiel.load_game('imposter_zero')
state = game.new_initial_state()
print(f'Game: {game}')
print(f'State: {state}')
print(f'Player: {state.current_player()}')
print(f'Actions: {state.legal_actions()}')
print('All checks passed.')
"
