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
import math
import pickle
import random
import time
from collections import deque
from dataclasses import dataclass
from itertools import combinations
from multiprocessing import Pool, set_start_method
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
    (weights_bytes, n_episodes, seed, input_size, hidden, n_layers,
     n_actions, n_sims, use_gumbel) = args

    # Reconstruct network
    net = BlazingNet(input_size, hidden, n_actions, n_layers)
    net.load_state_dict(pickle.loads(weights_bytes))
    net.eval()

    game = pyspiel.load_game("imposter_zero_match")
    rng = random.Random(seed)
    results = []

    for _ in range(n_episodes):
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

        returns = state.returns() if state.is_terminal() else [0.0, 0.0]
        results.append((trajectory, returns[0]))

    return results


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

    parser.add_argument("--max_time", type=int, default=0)
    parser.add_argument("--max_episodes", type=int, default=1_000_000)

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

    args = parser.parse_args()

    if args.output is None:
        args.output = generate_timestamped_output("./training", args.output_prefix)
        print(f"  Output: {args.output}")

    check_output_path(args.output, None)

    if args.seed is not None:
        random.seed(args.seed)
        np.random.seed(args.seed)
        torch.manual_seed(args.seed)

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

    net = BlazingNet(OBS_SIZE, args.hidden_size, NUM_ACTIONS, args.num_layers).to(device)
    frozen = BlazingNet(OBS_SIZE, args.hidden_size, NUM_ACTIONS, args.num_layers).to(device)
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
    print()
    if args.max_time > 0:
        print(f"  Max time:      {args.max_time}s")
    print()
    print("=" * 60)
    print()

    game = pyspiel.load_game("imposter_zero_match")
    pool = Pool(processes=args.num_workers)

    # Replay buffer
    buffer = deque(maxlen=100_000)

    start = time.time()
    last_report = start
    episode = 0
    best_wr = 0.0
    metrics = {}

    try:
        while True:
            elapsed = time.time() - start
            if args.max_time > 0 and elapsed >= args.max_time:
                break
            if episode >= args.max_episodes:
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

            all_results = pool.map(_worker_play_games, worker_args)

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
                        "n_simulations": args.n_simulations,
                        "episodes": episode,
                        "win_rate": round(wr, 4),
                    })
                    net.to(device)

                if wr_f >= 0.55:
                    frozen.load_state_dict(net.state_dict())

            # Cleanup
            if episode % 5000 == 0:
                gc.collect()

    except KeyboardInterrupt:
        print("\nInterrupted")
    finally:
        pool.terminate()
        pool.join()

    elapsed = time.time() - start
    print()
    print("=" * 60)
    print(f"  Done: {episode:,} episodes in {elapsed:.1f}s ({episode/elapsed:.1f} eps/s)")
    print("=" * 60)

    net.cpu()
    wr = evaluate_vs_random(game, net, torch.device("cpu"), args.eval_games)
    print(f"  Final: {wr:.1%}, Best: {best_wr:.1%}")

    if wr >= best_wr:
        export_weights(net, args.output, {
            "algorithm": "blazing_mk_iii",
            "episodes": episode,
            "win_rate": round(wr, 4),
        })
    print(f"  -> {args.output}")


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
