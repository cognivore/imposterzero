"""
Blazing MK-III — Multiprocessed Gumbel Training

Combines:
1. Multiprocessing for game simulation (like train_mcts.py)
2. Gumbel search with minimal simulations
3. Intent-conditioned mustering
4. GPU training on main process

Architecture:
  Workers (CPU) --[trajectories]--> Main (GPU training)

Usage:
  python train_blazing_mk_iii.py --max_time 3600 --num_workers 12
"""

from __future__ import annotations

import argparse
import gc
import json
import math
import os
import pickle
import random
import signal
import subprocess
import sys
import time
from collections import deque
from dataclasses import dataclass
from itertools import combinations
from multiprocessing import Pool, set_start_method, TimeoutError as MPTimeoutError
import traceback
from typing import Dict, FrozenSet, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import pyspiel

import imposter_zero.game as ig

from train_ppo import (
    OBS_SIZE, NUM_ACTIONS,
    raw_observation,
    compute_gae,
    evaluate_vs_random,
    evaluate_vs_frozen,
    export_weights,
    generate_timestamped_output,
    check_output_path,
)

# ---------------------------------------------------------------------------
# Graceful Shutdown
# ---------------------------------------------------------------------------

_shutdown_requested = False

def _signal_handler(signum, frame):
    """Handle SIGTERM/SIGINT for graceful shutdown."""
    global _shutdown_requested
    sig_name = signal.Signals(signum).name
    print(f"\n[{sig_name}] Shutdown requested, finishing current batch...", flush=True)
    _shutdown_requested = True


def _validate_typescript_compat(policy_path: str) -> bool:
    """Run the TypeScript compatibility validator on the exported policy."""
    validator = os.path.join(os.path.dirname(__file__), "activate_policy.py")
    if not os.path.exists(validator):
        print(f"  [WARN] Validator not found: {validator}", flush=True)
        return True  # Don't block training if validator missing

    try:
        result = subprocess.run(
            [sys.executable, validator, policy_path, "--quiet"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            print(f"  ✓ TypeScript compatible", flush=True)
            return True
        else:
            print(f"  ✗ TypeScript validation failed:", flush=True)
            for line in result.stdout.strip().split('\n'):
                if line.strip():
                    print(f"    {line}", flush=True)
            return False
    except subprocess.TimeoutExpired:
        print(f"  [WARN] Validator timed out", flush=True)
        return True
    except Exception as e:
        print(f"  [WARN] Validator error: {e}", flush=True)
        return True


def _load_checkpoint(checkpoint_path: str, net: nn.Module, device) -> Tuple[int, float]:
    """Load weights from a checkpoint file. Returns (episode_count, best_win_rate)."""
    print(f"  Loading checkpoint: {checkpoint_path}", flush=True)

    with open(checkpoint_path) as f:
        data = json.load(f)

    # Load weights into network
    weights = data["weights"]
    sd = net.state_dict()
    linear_keys = [(k.rsplit(".", 1)[0], k) for k in sd if k.endswith(".weight")]
    linear_keys.sort(key=lambda t: t[1])

    for i, (prefix, wkey) in enumerate(linear_keys):
        w_name = f"w{i + 1}"
        b_name = f"b{i + 1}"
        if w_name in weights:
            sd[wkey] = torch.tensor(weights[w_name])
        if b_name in weights:
            bkey = prefix + ".bias"
            sd[bkey] = torch.tensor(weights[b_name])

    net.load_state_dict(sd)
    net.to(device)

    # Extract training state from metadata
    meta = data.get("metadata", {})
    episode = meta.get("episodes", 0)
    win_rate = meta.get("win_rate_vs_random", 0.0)

    print(f"  Resumed from episode {episode:,} (win rate: {win_rate:.1%})", flush=True)
    return episode, win_rate


# ---------------------------------------------------------------------------
# Memory Management
# ---------------------------------------------------------------------------

def cleanup_memory(device):
    """Clean up GPU/MPS memory and force garbage collection."""
    gc.collect()
    if device.type == "mps":
        torch.mps.empty_cache()
    elif device.type == "cuda":
        torch.cuda.empty_cache()


# ---------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------

class BlazingNet(nn.Module):
    def __init__(self, input_size: int, hidden: int, n_actions: int, n_layers: int = 4):
        super().__init__()
        layers = []
        d = input_size
        for _ in range(n_layers - 1):
            layers += [nn.Linear(d, hidden), nn.ReLU(inplace=True)]
            d = hidden
        self.encoder = nn.Sequential(*layers)
        self.policy_head = nn.Linear(hidden, n_actions)
        self.value_head = nn.Linear(hidden, 1)

        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=0.01)
                nn.init.zeros_(m.bias)

    def forward(self, x):
        h = self.encoder(x)
        return self.policy_head(h), self.value_head(h).squeeze(-1)

    def policy(self, x):
        return self.policy_head(self.encoder(x))


# ---------------------------------------------------------------------------
# Intent System (compact)
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class Intent:
    targets: FrozenSet[int]
    facet: Optional[str]


def get_intents(state, player: int) -> List[Intent]:
    hand = state._hands[player]
    army = state._army_ids[player]
    facet = state._king_facets[player]
    max_r = min(len(hand), len(army))
    facets = [None] if facet != "default" else [None, "charismatic", "masterTactician"]

    intents = []
    for n in range(max_r + 1):
        for combo in combinations(army, n):
            for f in facets:
                intents.append(Intent(frozenset(combo), f))
    return intents


def execute_intent(state, player: int, intent: Intent) -> List[int]:
    actions = []
    mcid, np = state._max_card_id, 2
    hand, army = list(state._hands[player]), list(state._army_ids[player])
    has_exh = state._has_exhausted_this_mustering
    val = state._card_values.get

    if intent.facet and state._king_facets[player] == "default":
        actions.append(ig._encode_select_king(0 if intent.facet == "charismatic" else 1, mcid, np))

    for target in sorted(intent.targets, key=lambda c: val(c, 0), reverse=True):
        if not hand or target not in army:
            continue
        if not has_exh:
            cands = [c for c in army if c != target] or army
            exh = min(cands, key=lambda c: val(c, 0))
            actions.append(ig._encode_begin_recruit(exh, mcid, np))
            army.remove(exh)
            has_exh = True
        disc = min(hand, key=lambda c: val(c, 0))
        actions.append(ig._encode_recruit(disc, target, mcid, np))
        hand.remove(disc)
        if target in army:
            army.remove(target)
        hand.append(target)
        has_exh = False

    actions.append(ig._encode_end_mustering(mcid, np))
    return actions


# ---------------------------------------------------------------------------
# Worker Function
# ---------------------------------------------------------------------------

def _worker_play_games(args):
    """
    Worker: play games using network weights, return trajectories.
    Uses Gumbel search with minimal simulations.
    """
    try:
        (weights_bytes, n_episodes, seed, input_size, hidden, n_layers,
         n_actions, n_sims, use_gumbel) = args

        # Reconstruct network
        net = BlazingNet(input_size, hidden, n_actions, n_layers)
        net.load_state_dict(pickle.loads(weights_bytes))
        net.eval()

        game = pyspiel.load_game("imposter_zero_match")
        rng = random.Random(seed)
        results = []

        for ep_idx in range(n_episodes):
            state = game.new_initial_state()
            trajectory = []
            pending_actions = []

            while not state.is_terminal():
                player = state.current_player()
                if player < 0:
                    break

                legal = state.legal_actions()
                if not legal:
                    break

                # Handle pending intent actions
                if pending_actions:
                    action = pending_actions.pop(0)
                    if action in legal:
                        if player == 0:
                            obs = raw_observation(state, player)
                            with torch.no_grad():
                                obs_t = torch.tensor([obs], dtype=torch.float32)
                                _, val = net(obs_t)
                            trajectory.append((obs, action, legal, val.item()))
                        state.apply_action(action)
                    else:
                        pending_actions.clear()
                    continue

                obs = raw_observation(state, player)
                phase = getattr(state, "_phase", "play")

                if player == 0:
                    # Player 0 decision
                    if phase == "mustering":
                        # Intent-based mustering
                        intents = get_intents(state, player)
                        if len(intents) > 1:
                            intent = _select_intent_fast(state, player, intents, net, n_sims)
                        else:
                            intent = intents[0] if intents else Intent(frozenset(), None)

                        actions = execute_intent(state, player, intent)
                        if actions and actions[0] in legal:
                            pending_actions = actions[1:]
                            action = actions[0]
                            with torch.no_grad():
                                obs_t = torch.tensor([obs], dtype=torch.float32)
                                _, val = net(obs_t)
                            trajectory.append((obs, action, legal, val.item()))
                            state.apply_action(action)
                            continue

                    # Standard action selection
                    with torch.no_grad():
                        obs_t = torch.tensor([obs], dtype=torch.float32)
                        logits, val = net(obs_t)
                        logits = logits.squeeze(0).clamp(-50, 50)
                        value = val.item()

                    if use_gumbel and len(legal) > 2:
                        action = _gumbel_select_fast(state, player, legal, logits, net, n_sims)
                    else:
                        mask = torch.full((n_actions,), -1e9)
                        for a in legal:
                            mask[a] = 0.0
                        probs = F.softmax(logits + mask, dim=0)
                        if torch.isnan(probs).any():
                            action = rng.choice(legal)
                        else:
                            action = torch.multinomial(probs, 1).item()

                    trajectory.append((obs, action, legal, value))

                else:
                    # Opponent
                    with torch.no_grad():
                        obs_t = torch.tensor([obs], dtype=torch.float32)
                        logits, _ = net(obs_t)
                        logits = logits.squeeze(0).clamp(-50, 50)

                    mask = torch.full((n_actions,), -1e9)
                    for a in legal:
                        mask[a] = 0.0
                    probs = F.softmax(logits + mask, dim=0)
                    if torch.isnan(probs).any():
                        action = rng.choice(legal)
                    else:
                        action = torch.multinomial(probs, 1).item()

                state.apply_action(action)

            # End of episode - outside while loop, inside for loop
            returns = state.returns() if state.is_terminal() else [0.0, 0.0]
            results.append((trajectory, returns[0]))

            # Periodic cleanup to prevent memory accumulation
            if ep_idx % 4 == 3:
                gc.collect()

        return results

    except Exception as e:
        print(f"[Worker Error] {e}\n{traceback.format_exc()}", flush=True)
        return []  # Return empty so main process continues


def _select_intent_fast(state, player: int, intents: List[Intent], net, n_sims: int) -> Intent:
    """Quick intent selection with value-based scoring."""
    sample = intents if len(intents) <= n_sims else random.sample(intents, n_sims)

    best_intent = intents[0]
    best_score = float('-inf')

    for intent in sample:
        actions = execute_intent(state, player, intent)
        if not actions:
            continue

        sim = state._clone_impl()
        try:
            valid = True
            for a in actions:
                if a in sim.legal_actions():
                    sim.apply_action(a)
                else:
                    valid = False
                    break

            if not valid:
                continue

            if sim.is_terminal():
                score = sim.returns()[player]
            else:
                obs = raw_observation(sim, sim.current_player())
                with torch.no_grad():
                    obs_t = torch.tensor([obs], dtype=torch.float32)
                    _, val = net(obs_t)
                    score = val.item()

            # Bonus for high-value recruits
            bonus = sum(state._card_values.get(c, 0) for c in intent.targets) / 72.0
            score += 0.1 * bonus

            if score > best_score:
                best_score = score
                best_intent = intent
        finally:
            del sim  # Explicit cleanup of cloned state

    return best_intent


def _gumbel_select_fast(state, player: int, legal: List[int], logits: torch.Tensor,
                        net, n_sims: int) -> int:
    """Gumbel action selection with limited simulations."""
    k = min(len(legal), max(2, n_sims))

    # Gumbel-Top-k
    mask = torch.full_like(logits, -1e9)
    legal_t = torch.tensor(legal)
    mask[legal_t] = 0.0
    masked = logits + mask

    gumbels = -torch.log(-torch.log(torch.rand_like(masked).clamp(1e-10, 1-1e-10)))
    perturbed = masked + gumbels

    topk_vals, topk_idx = torch.topk(perturbed, k)
    candidates = [a for a in topk_idx.tolist() if a in legal][:k]

    if len(candidates) <= 1:
        return candidates[0] if candidates else legal[0]

    # Simulate and evaluate
    best_action = candidates[0]
    best_value = float('-inf')

    for action in candidates:
        sim = state._clone_impl()
        try:
            sim.apply_action(action)

            if sim.is_terminal():
                value = sim.returns()[player]
            else:
                obs = raw_observation(sim, sim.current_player())
                with torch.no_grad():
                    obs_t = torch.tensor([obs], dtype=torch.float32)
                    _, val = net(obs_t)
                    value = val.item()

            if value > best_value:
                best_value = value
                best_action = action
        finally:
            del sim  # Explicit cleanup of cloned state

    return best_action


# ---------------------------------------------------------------------------
# Main Training Loop
# ---------------------------------------------------------------------------

def main():
    try:
        set_start_method("spawn")
    except RuntimeError:
        pass

    parser = argparse.ArgumentParser(description="Blazing MK-III: Multiprocessed Gumbel Training")

    parser.add_argument("--max_time", type=int, default=0,
                        help="Max training time in seconds (0 = unlimited, just Ctrl+C when done)")
    parser.add_argument("--max_episodes", type=int, default=0,
                        help="Max episodes (0 = unlimited)")

    # Workers
    parser.add_argument("--num_workers", type=int, default=12)
    parser.add_argument("--episodes_per_worker", type=int, default=8)

    # Network
    parser.add_argument("--hidden_size", type=int, default=512)
    parser.add_argument("--num_layers", type=int, default=4)

    # Gumbel
    parser.add_argument("--n_simulations", type=int, default=4)
    parser.add_argument("--no_search", action="store_true")

    # Training
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--train_batch_size", type=int, default=4096)
    parser.add_argument("--entropy_coeff", type=float, default=0.01)
    parser.add_argument("--gamma", type=float, default=0.99)
    parser.add_argument("--gae_lambda", type=float, default=0.95)
    parser.add_argument("--ppo_epochs", type=int, default=4)

    # Eval
    parser.add_argument("--eval_every", type=int, default=5000)
    parser.add_argument("--eval_games", type=int, default=200)

    # Output
    parser.add_argument("--output", type=str, default=None)
    parser.add_argument("--output_prefix", type=str, default="policy_blazing3")
    parser.add_argument("--seed", type=int, default=None)

    # Resume
    parser.add_argument("--resume", type=str, default=None,
                        help="Resume from checkpoint file (use .checkpoint.json for fine-tuning)")

    args = parser.parse_args()

    if args.output is None:
        args.output = generate_timestamped_output("./training", args.output_prefix)
        print(f"  Output: {args.output}")

    check_output_path(args.output, args.resume)

    # Setup signal handlers for graceful shutdown
    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    if args.seed is not None:
        random.seed(args.seed)
        np.random.seed(args.seed)
        torch.manual_seed(args.seed)

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

    net = BlazingNet(OBS_SIZE, args.hidden_size, NUM_ACTIONS, args.num_layers).to(device)
    frozen = BlazingNet(OBS_SIZE, args.hidden_size, NUM_ACTIONS, args.num_layers).to(device)

    # Resume from checkpoint if specified
    resumed_episode = 0
    resumed_wr = 0.0
    if args.resume:
        resumed_episode, resumed_wr = _load_checkpoint(args.resume, net, device)

    frozen.load_state_dict(net.state_dict())

    optimizer = torch.optim.Adam(net.parameters(), lr=args.lr)
    n_params = sum(p.numel() for p in net.parameters())
    batch_size = args.num_workers * args.episodes_per_worker

    print()
    print("=" * 60)
    print("  Blazing MK-III — Multiprocessed Gumbel Training")
    print("=" * 60)
    print()
    print(f"  Device:        {device}")
    print(f"  Workers:       {args.num_workers} x {args.episodes_per_worker} eps")
    print(f"  Network:       {n_params:,} params")
    print(f"  Gumbel:        {'OFF' if args.no_search else f'{args.n_simulations} sims'}")
    if args.resume:
        print(f"  Resumed from:  {os.path.basename(args.resume)}")
        print(f"  Start episode: {resumed_episode:,}")
    if args.max_time > 0 or args.max_episodes > 0:
        print()
        if args.max_time > 0:
            print(f"  Max time:      {args.max_time}s")
        if args.max_episodes > 0:
            print(f"  Max episodes:  {args.max_episodes:,}")
    print()
    print("  Press Ctrl+C to stop and save checkpoint")
    print()
    print("=" * 60)
    print()

    game = pyspiel.load_game("imposter_zero_match")
    # Recycle workers every 10 batches to bound memory growth without constant respawn overhead
    pool = Pool(processes=args.num_workers, maxtasksperchild=10)

    # Replay buffer
    buffer = deque(maxlen=100_000)

    start = time.time()
    last_report = start
    episode = resumed_episode
    best_wr = resumed_wr
    metrics = {}
    stop_reason = "max_episodes"

    try:
        while True:
            # Check for graceful shutdown
            if _shutdown_requested:
                stop_reason = "shutdown_requested"
                break

            elapsed = time.time() - start
            if args.max_time > 0 and elapsed >= args.max_time:
                stop_reason = "max_time"
                break
            if args.max_episodes > 0 and episode >= args.max_episodes:
                stop_reason = "max_episodes"
                break

            # Serialize weights
            net.cpu()
            weights_bytes = pickle.dumps(net.state_dict())
            net.to(device)

            # Dispatch workers
            base_seed = random.randint(0, 2**31)
            worker_args = [
                (weights_bytes, args.episodes_per_worker, base_seed + i,
                 OBS_SIZE, args.hidden_size, args.num_layers, NUM_ACTIONS,
                 args.n_simulations, not args.no_search)
                for i in range(args.num_workers)
            ]

            try:
                async_result = pool.map_async(_worker_play_games, worker_args)
                all_results = async_result.get(timeout=120)  # 2 minute timeout
            except MPTimeoutError:
                print("[WARN] Worker timeout, recreating pool", flush=True)
                pool.terminate()
                pool.join()
                pool = Pool(processes=args.num_workers, maxtasksperchild=10)
                continue  # Skip this batch

            # Process results
            for worker_results in all_results:
                for trajectory, final_return in worker_results:
                    if not trajectory:
                        continue

                    values = [t[3] for t in trajectory]
                    advantages, returns = compute_gae(
                        final_return, values, args.gamma, args.gae_lambda
                    )

                    for i, (obs, action, legal, _) in enumerate(trajectory):
                        adv = advantages[i] if i < len(advantages) else 0.0
                        ret = returns[i] if i < len(returns) else final_return
                        if not (math.isnan(adv) or math.isnan(ret)):
                            buffer.append((obs, action, legal, adv, ret))

                    episode += 1

            # Training
            if len(buffer) >= args.train_batch_size:
                indices = random.sample(range(len(buffer)), args.train_batch_size)
                batch = [buffer[i] for i in indices]

                obs = [b[0] for b in batch]
                actions = [b[1] for b in batch]
                legals = [b[2] for b in batch]
                advantages = [b[3] for b in batch]
                returns = [b[4] for b in batch]

                metrics = _train_step(net, optimizer, obs, actions, legals,
                                     advantages, returns, device, args.entropy_coeff)

            # Report
            now = time.time()
            if now - last_report >= 30:
                eps_per_sec = episode / (now - start) if now > start else 0
                print(
                    f"[{(now-start)/60:.1f}m] {episode:,} eps ({eps_per_sec:.1f}/s) "
                    f"| buf={len(buffer):,} "
                    f"| p={metrics.get('policy_loss', 0):.4f} "
                    f"| e={metrics.get('entropy', 0):.3f}"
                )
                last_report = now

            # Eval
            if episode > 0 and episode % args.eval_every < batch_size:
                wr = evaluate_vs_random(game, net, device, args.eval_games)
                wr_f = evaluate_vs_frozen(game, net, frozen, device, args.eval_games // 2)
                print(f"[Eval {episode:,}] vs-random={wr:.1%} vs-frozen={wr_f:.1%} | best={best_wr:.1%}")

                if wr > best_wr:
                    best_wr = wr
                    net.cpu()
                    export_weights(net, args.output, {
                        "algorithm": "blazing_mk_iii",
                        "action_space": "raw",
                        "num_actions": NUM_ACTIONS,
                        "input_size": OBS_SIZE,
                        "hidden_size": args.hidden_size,
                        "num_layers": args.num_layers - 1,  # Actual hidden layers in encoder
                        "output_size": NUM_ACTIONS,
                        "n_simulations": args.n_simulations,
                        "episodes": episode,
                        "win_rate_vs_random": round(wr, 4),
                    }, exclude_prefixes=["value_head"])
                    _validate_typescript_compat(args.output)
                    net.to(device)

                if wr_f >= 0.55:
                    frozen.load_state_dict(net.state_dict())

            # Cleanup memory periodically
            if episode % 1000 == 0:
                cleanup_memory(device)

    except KeyboardInterrupt:
        stop_reason = "keyboard_interrupt"
        print("\n[KeyboardInterrupt] Saving checkpoint...")
    except Exception as e:
        stop_reason = f"error: {e}"
        print(f"\n[ERROR] {e}")
        traceback.print_exc()
    finally:
        pool.terminate()
        pool.join()

    elapsed = time.time() - start
    print()
    print("=" * 60)
    print(f"  Done: {episode:,} episodes in {elapsed:.1f}s ({episode/elapsed:.1f} eps/s)")
    print(f"  Stop reason: {stop_reason}")
    print("=" * 60)

    # Always save checkpoint on exit (for resume capability)
    net.cpu()
    print("  Saving final checkpoint...")
    export_weights(net, args.output, {
        "algorithm": "blazing_mk_iii",
        "action_space": "raw",
        "num_actions": NUM_ACTIONS,
        "input_size": OBS_SIZE,
        "hidden_size": args.hidden_size,
        "num_layers": args.num_layers - 1,  # Actual hidden layers in encoder
        "output_size": NUM_ACTIONS,
        "n_simulations": args.n_simulations,
        "episodes": episode,
        "win_rate_vs_random": round(best_wr, 4),
        "stop_reason": stop_reason,
    }, exclude_prefixes=["value_head"])
    _validate_typescript_compat(args.output)

    # Show resume command
    checkpoint_path = args.output.replace(".json", ".checkpoint.json")
    print()
    print(f"  Inference:  {args.output}")
    print(f"  Checkpoint: {checkpoint_path}")
    print()
    print(f"  To resume training:")
    print(f"    python {os.path.basename(__file__)} --resume {checkpoint_path}")
    print()


def _train_step(net, optimizer, obs, actions, legals, advantages, returns,
                device, entropy_coeff=0.01, value_coeff=0.5):
    n = len(obs)
    if n == 0:
        return {}

    obs_t = torch.tensor(obs, dtype=torch.float32, device=device)
    acts_t = torch.tensor(actions, dtype=torch.long, device=device)
    adv_t = torch.tensor(advantages, dtype=torch.float32, device=device).clamp(-10, 10)
    ret_t = torch.tensor(returns, dtype=torch.float32, device=device).clamp(-10, 10)

    if adv_t.std() > 1e-8:
        adv_t = (adv_t - adv_t.mean()) / (adv_t.std() + 1e-8)

    masks = torch.full((n, NUM_ACTIONS), -1e9, device=device)
    for i, legal in enumerate(legals):
        for a in legal:
            masks[i, a] = 0.0

    logits, values = net(obs_t)
    logits = logits.clamp(-50, 50) + masks

    log_probs = F.log_softmax(logits, dim=1)
    action_lp = log_probs.gather(1, acts_t.unsqueeze(1)).squeeze(1)
    action_lp = torch.nan_to_num(action_lp, nan=0.0, neginf=-10.0)

    policy_loss = -(action_lp * adv_t).mean()
    value_loss = F.mse_loss(values, ret_t)

    probs = F.softmax(logits, dim=1)
    entropy = -torch.nan_to_num(probs * log_probs, nan=0.0).sum(1).mean()

    loss = policy_loss + value_coeff * value_loss - entropy_coeff * entropy

    if torch.isnan(loss):
        return {"policy_loss": 0.0, "value_loss": 0.0, "entropy": 0.0}

    optimizer.zero_grad()
    loss.backward()
    torch.nn.utils.clip_grad_norm_(net.parameters(), 0.5)
    optimizer.step()

    return {
        "policy_loss": policy_loss.item(),
        "value_loss": value_loss.item(),
        "entropy": entropy.item(),
    }


if __name__ == "__main__":
    main()
