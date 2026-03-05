#!/usr/bin/env bash
set -euo pipefail

VENV=/Users/sweater/Github/imposterzero/training/.venv/bin/python3
TRAINER=/Users/sweater/Github/imposterzero/training/train_neural.py
FAST=/Users/sweater/Github/imposterzero/training/policy_3p_fast.json
HOURTRAIN=/Users/sweater/Github/imposterzero/training/policy_3p_hourtrain.json

HOURTRAIN_PID="${1:-}"

if [ -n "$HOURTRAIN_PID" ] && kill -0 "$HOURTRAIN_PID" 2>/dev/null; then
    echo "[population] Waiting for hourtrain (PID $HOURTRAIN_PID)..."
    while kill -0 "$HOURTRAIN_PID" 2>/dev/null; do sleep 15; done
    echo "[population] Hourtrain finished."
fi

[ -f "$FAST" ]      || { echo "ERROR: $FAST missing"; exit 1; }
[ -f "$HOURTRAIN" ] || { echo "ERROR: $HOURTRAIN missing"; exit 1; }

echo ""
echo "========================================================"
echo " Launching 3 training runs in parallel"
echo "========================================================"
echo " 1. fasthourtrained   — fine-tune fast (2-layer 128) with self-play"
echo " 2. hourhourtrained   — fine-tune hourtrain (3-layer 256) with self-play"
echo " 3. hourtrainedvs     — fresh 3-layer 256, trained vs fast + hourtrain"
echo "========================================================"
echo ""

# 1. Fine-tune fast model with more self-play
$VENV -u "$TRAINER" \
    --max_time 7200 --episodes 99999999 --patience 15 \
    --batch_size 64 --lr 1e-4 --entropy_coeff 0.015 \
    --hidden_size 128 --num_layers 2 \
    --eval_every 20000 --eval_games 3000 \
    --output ./training/policy_3p_fasthourtrained.json \
    --seed 1111 \
    --resume "$FAST" \
    > /Users/sweater/.cursor/projects/Users-sweater-Github-imposterzero/terminals/fasthourtrained.log 2>&1 &
PID1=$!
echo "[population] fasthourtrained  PID=$PID1"

# 2. Fine-tune hourtrain model with more self-play
$VENV -u "$TRAINER" \
    --max_time 7200 --episodes 99999999 --patience 15 \
    --batch_size 128 --lr 5e-5 --entropy_coeff 0.008 \
    --hidden_size 256 --num_layers 3 \
    --eval_every 20000 --eval_games 3000 \
    --output ./training/policy_3p_hourhourtrained.json \
    --seed 2222 \
    --resume "$HOURTRAIN" \
    > /Users/sweater/.cursor/projects/Users-sweater-Github-imposterzero/terminals/hourhourtrained.log 2>&1 &
PID2=$!
echo "[population] hourhourtrained  PID=$PID2"

# 3. Train from scratch against fast + hourtrain as opponents
$VENV -u "$TRAINER" \
    --max_time 7200 --episodes 99999999 --patience 15 \
    --batch_size 128 --lr 1e-4 --entropy_coeff 0.01 \
    --hidden_size 256 --num_layers 3 \
    --eval_every 20000 --eval_games 3000 \
    --output ./training/policy_3p_hourtrainedvs.json \
    --seed 9999 \
    --opponents "$FAST" "$HOURTRAIN" \
    > /Users/sweater/.cursor/projects/Users-sweater-Github-imposterzero/terminals/hourtrainedvs.log 2>&1 &
PID3=$!
echo "[population] hourtrainedvs    PID=$PID3"

echo ""
echo "[population] All 3 running. Monitor with:"
echo "  tail -5 ~/.cursor/projects/Users-sweater-Github-imposterzero/terminals/fasthourtrained.log"
echo "  tail -5 ~/.cursor/projects/Users-sweater-Github-imposterzero/terminals/hourhourtrained.log"
echo "  tail -5 ~/.cursor/projects/Users-sweater-Github-imposterzero/terminals/hourtrainedvs.log"
echo ""

wait $PID1 $PID2 $PID3
echo "[population] All 3 training runs complete."
