"""
GPU-accelerated REINFORCE self-play for 2p expansion matches.

Uses multiprocessing for parallel game simulation across CPU cores
and MPS (Apple Metal) for batched policy forward/backward passes.

Architecture:
  - Workers simulate episodes on CPU with a frozen copy of the policy
  - Main process collects trajectories, does batched GPU gradient update
  - Weights are synced to workers after each training step

Usage:
  python train_match_gpu.py --max_time 28800 --output ./training/policy_match_neural.json
"""

import argparse
import json
import math
import os
import pickle
import random
import time
from multiprocessing import Pool, set_start_method

import torch
import torch.nn as nn
import torch.nn.functional as F
import pyspiel

import imposter_zero.game  # noqa: F401 — registers games
from imposter_zero.abstraction import (
    ABSTRACT_ACTIONS,
    enriched_obs,
    enriched_obs_size,
    group_legal_by_abstract,
)

NUM_ABS = len(ABSTRACT_ACTIONS)
ABS_TO_IDX = {a: i for i, a in enumerate(ABSTRACT_ACTIONS)}
OBS_SIZE = enriched_obs_size()


# ---------------------------------------------------------------------------
# Policy network
# ---------------------------------------------------------------------------

class PolicyNet(nn.Module):
    def __init__(self, input_size=OBS_SIZE, hidden_size=256, output_size=NUM_ABS, num_layers=3):
        super().__init__()
        layers = [nn.Linear(input_size, hidden_size), nn.ReLU()]
        for _ in range(num_layers - 2):
            layers += [nn.Linear(hidden_size, hidden_size), nn.ReLU()]
        layers.append(nn.Linear(hidden_size, output_size))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


# ---------------------------------------------------------------------------
# Worker: simulate episodes on CPU
# ---------------------------------------------------------------------------

def _worker_simulate(args):
    """Run in a subprocess. Returns list of (obs_list, act_idx_list, player_list, returns)."""
    weights_bytes, n_episodes, seed, input_size, hidden_size, num_layers = args

    net = PolicyNet(input_size, hidden_size, NUM_ABS, num_layers)
    net.load_state_dict(pickle.loads(weights_bytes))
    net.eval()

    game = pyspiel.load_game("imposter_zero_match")
    rng = random.Random(seed)
    results = []

    for _ in range(n_episodes):
        state = game.new_initial_state()
        obs_list = []
        act_list = []
        player_list = []

        while not state.is_terminal():
            player = state.current_player()
            if player < 0:
                break

            legal = state.legal_actions()
            groups = group_legal_by_abstract(state, legal, player)
            available = list(groups.keys())

            obs = enriched_obs(state, player)

            with torch.no_grad():
                obs_t = torch.tensor([obs], dtype=torch.float32)
                logits = net(obs_t).squeeze(0)

            mask = torch.full((NUM_ABS,), float("-inf"))
            for a in available:
                idx = ABS_TO_IDX.get(a)
                if idx is not None:
                    mask[idx] = 0.0

            masked = logits + mask
            probs = F.softmax(masked, dim=0)
            sampled_idx = torch.multinomial(probs, 1).item()

            chosen_abs = ABSTRACT_ACTIONS[sampled_idx]
            concrete_options = groups.get(chosen_abs, legal)
            concrete = rng.choice(concrete_options)

            obs_list.append(obs)
            act_list.append(sampled_idx)
            player_list.append(player)
            state.apply_action(concrete)

        returns = state.returns() if state.is_terminal() else [0.0, 0.0]
        results.append((obs_list, act_list, player_list, returns))

    return results


# ---------------------------------------------------------------------------
# Evaluation (single-process, no grad)
# ---------------------------------------------------------------------------

def evaluate_vs_random(game, net, device, num_games=1000):
    wins = 0
    net.eval()
    with torch.no_grad():
        for _ in range(num_games):
            state = game.new_initial_state()
            steps = 0
            while not state.is_terminal() and steps < 800:
                player = state.current_player()
                if player < 0:
                    break
                if player == 0:
                    legal = state.legal_actions()
                    groups = group_legal_by_abstract(state, legal, player)
                    available = list(groups.keys())
                    obs = enriched_obs(state, player)
                    obs_t = torch.tensor([obs], dtype=torch.float32, device=device)
                    logits = net(obs_t).squeeze(0)
                    mask = torch.full((NUM_ABS,), float("-inf"), device=device)
                    for a in available:
                        idx = ABS_TO_IDX.get(a)
                        if idx is not None:
                            mask[idx] = 0.0
                    probs = F.softmax(logits + mask, dim=0)
                    sampled_idx = torch.multinomial(probs, 1).item()
                    chosen_abs = ABSTRACT_ACTIONS[sampled_idx]
                    concrete = random.choice(groups.get(chosen_abs, legal))
                    state.apply_action(concrete)
                else:
                    state.apply_action(random.choice(state.legal_actions()))
                steps += 1
            if state.is_terminal() and state.returns()[0] > 0:
                wins += 1
    net.train()
    return wins / num_games


# ---------------------------------------------------------------------------
# Export weights as JSON (same format as train_neural.py)
# ---------------------------------------------------------------------------

def export_weights(net, output_path, metadata):
    sd = net.state_dict()
    weights = {}
    linear_keys = [(k.rsplit(".", 1)[0], k) for k in sd if k.endswith(".weight")]
    linear_keys.sort(key=lambda t: t[1])
    for i, (prefix, wkey) in enumerate(linear_keys):
        bkey = prefix + ".bias"
        weights[f"w{i + 1}"] = sd[wkey].cpu().tolist()
        if bkey in sd:
            weights[f"b{i + 1}"] = sd[bkey].cpu().tolist()
    payload = {"metadata": metadata, "weights": weights}
    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(payload, f)
    size_kb = os.path.getsize(output_path) / 1024
    print(f"  -> Exported: {size_kb:.1f} KB -> {output_path}")


# ---------------------------------------------------------------------------
# Main training loop
# ---------------------------------------------------------------------------

def main():
    try:
        set_start_method("spawn")
    except RuntimeError:
        pass

    parser = argparse.ArgumentParser(description="GPU REINFORCE for 2p expansion matches")
    parser.add_argument("--episodes", type=int, default=2_000_000)
    parser.add_argument("--max_time", type=int, default=0)
    parser.add_argument("--num_workers", type=int, default=12)
    parser.add_argument("--episodes_per_worker", type=int, default=16)
    parser.add_argument("--hidden_size", type=int, default=256)
    parser.add_argument("--num_layers", type=int, default=3)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--entropy_coeff", type=float, default=0.05)
    parser.add_argument("--eval_every", type=int, default=10_000)
    parser.add_argument("--eval_games", type=int, default=1000)
    parser.add_argument("--output", type=str, default="./training/policy_match_neural.json")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--patience", type=int, default=0)
    parser.add_argument("--resume", type=str, default=None,
                        help="Path to policy JSON to resume from (loads weights)")
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)
        torch.manual_seed(args.seed)

    if torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")

    game = pyspiel.load_game("imposter_zero_match")
    n_players = game.num_players()
    input_size = OBS_SIZE
    net = PolicyNet(input_size, args.hidden_size, NUM_ABS, args.num_layers).to(device)

    if args.resume:
        with open(args.resume) as f:
            resume_data = json.load(f)
        rw = resume_data["weights"]
        sd = net.state_dict()
        linear_keys = [(k.rsplit(".", 1)[0], k) for k in sd if k.endswith(".weight")]
        linear_keys.sort(key=lambda t: t[1])
        for i, (prefix, wkey) in enumerate(linear_keys):
            sd[wkey] = torch.tensor(rw[f"w{i+1}"])
            bkey = prefix + ".bias"
            if bkey in sd and f"b{i+1}" in rw:
                sd[bkey] = torch.tensor(rw[f"b{i+1}"])
        net.load_state_dict(sd)
        net.to(device)
        resumed_eps = resume_data.get("metadata", {}).get("episodes", 0)
        resumed_wr = resume_data.get("metadata", {}).get("win_rate_vs_random", 0)
        print(f"  Resumed from: {args.resume} ({resumed_eps:,} eps, wr={resumed_wr:.1%})")

    optimizer = torch.optim.Adam(net.parameters(), lr=args.lr)

    batch_size = args.num_workers * args.episodes_per_worker
    time_limit = f"{args.max_time}s" if args.max_time > 0 else "unlimited"

    print(f"Imposter Zero 2p Match — GPU REINFORCE (self-play)")
    print(f"  Device:      {device}")
    print(f"  Network:     {input_size} -> {'x'.join([str(args.hidden_size)] * (args.num_layers - 1))} -> {NUM_ABS} ({args.num_layers} layers)")
    print(f"  Parameters:  {sum(p.numel() for p in net.parameters()):,}")
    print(f"  Workers:     {args.num_workers}")
    print(f"  Batch:       {batch_size} episodes ({args.episodes_per_worker}/worker)")
    print(f"  Max eps:     {args.episodes:,}")
    print(f"  Time limit:  {time_limit}")
    print(f"  LR:          {args.lr}")
    print(f"  Entropy:     {args.entropy_coeff}")
    print()

    start_time = time.time()
    last_report = start_time
    episode = 0
    best_wr = 0.0
    evals_without_improvement = 0
    stop_reason = "max_episodes"
    step = 0

    pool = Pool(processes=args.num_workers)

    try:
        while episode < args.episodes:
            if args.max_time > 0 and (time.time() - start_time) >= args.max_time:
                stop_reason = "time_limit"
                break

            net.cpu()
            weights_bytes = pickle.dumps(net.state_dict())
            net.to(device)

            base_seed = random.randint(0, 2**31)
            worker_args = [
                (weights_bytes, args.episodes_per_worker, base_seed + i,
                 input_size, args.hidden_size, args.num_layers)
                for i in range(args.num_workers)
            ]

            all_results = pool.map(_worker_simulate, worker_args)

            flat_obs = []
            flat_acts = []
            flat_rewards = []

            for worker_episodes in all_results:
                for obs_list, act_list, player_list, returns in worker_episodes:
                    for obs, act_idx, player in zip(obs_list, act_list, player_list):
                        flat_obs.append(obs)
                        flat_acts.append(act_idx)
                        flat_rewards.append(returns[player])

            episode += batch_size
            step += 1

            if not flat_obs:
                continue

            obs_t = torch.tensor(flat_obs, dtype=torch.float32, device=device)
            acts_t = torch.tensor(flat_acts, dtype=torch.long, device=device)
            rewards_t = torch.tensor(flat_rewards, dtype=torch.float32, device=device)

            rewards_t = (rewards_t - rewards_t.mean()) / (rewards_t.std() + 1e-8)

            logits = net(obs_t)
            log_probs = F.log_softmax(logits, dim=1)
            selected_lp = log_probs.gather(1, acts_t.unsqueeze(1)).squeeze(1)

            policy_loss = -(selected_lp * rewards_t).mean()
            entropy = -(F.softmax(logits, dim=1) * log_probs).sum(dim=1).mean()
            total_loss = policy_loss - args.entropy_coeff * entropy

            optimizer.zero_grad()
            total_loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            optimizer.step()

            now = time.time()
            if now - last_report >= 10.0 or episode >= args.episodes:
                elapsed = now - start_time
                rate = episode / elapsed
                if args.max_time > 0:
                    remaining = max(0, args.max_time - elapsed)
                    eta_str = f"remaining: {remaining:.0f}s"
                else:
                    eta = (args.episodes - episode) / rate if rate > 0 else 0
                    eta_str = f"ETA: {eta:.0f}s"
                print(
                    f"  ep {episode:>9,}"
                    f"  |  {rate:,.0f} ep/s"
                    f"  |  loss: {total_loss.item():.4f}"
                    f"  |  ent: {entropy.item():.3f}"
                    f"  |  best: {best_wr:.1%}"
                    f"  |  {eta_str}"
                )
                last_report = now

            if episode % args.eval_every < batch_size:
                net.cpu()
                wr = evaluate_vs_random(game, net, torch.device("cpu"), args.eval_games)
                net.to(device)
                print(f"  ** eval @ {episode:,}: win rate vs random = {wr:.1%}")
                if wr > best_wr:
                    best_wr = wr
                    evals_without_improvement = 0
                    meta = {
                        "algorithm": "reinforce_gpu_self_play",
                        "num_players": 2,
                        "game": "imposter_zero_match",
                        "game_version": "3.0-match",
                        "input_size": input_size,
                        "hidden_size": args.hidden_size,
                        "num_layers": args.num_layers,
                        "output_size": NUM_ABS,
                        "abstract_actions": list(ABSTRACT_ACTIONS),
                        "episodes": episode,
                        "win_rate_vs_random": round(wr, 4),
                        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    }
                    net.cpu()
                    export_weights(net, args.output, meta)
                    net.to(device)
                else:
                    evals_without_improvement += 1

                if args.patience > 0 and evals_without_improvement >= args.patience:
                    stop_reason = f"early_stop ({evals_without_improvement} evals w/o improvement)"
                    break

    finally:
        pool.terminate()
        pool.join()

    elapsed = time.time() - start_time
    print()
    print(f"Training finished: {episode:,} episodes in {elapsed:.1f}s ({stop_reason})")

    net.cpu()
    wr = evaluate_vs_random(game, net, torch.device("cpu"), args.eval_games)
    print(f"Final win rate vs random: {wr:.1%}")
    print(f"Best win rate: {best_wr:.1%}")

    if wr >= best_wr:
        meta = {
            "algorithm": "reinforce_gpu_self_play",
            "num_players": 2,
            "game": "imposter_zero_match",
            "game_version": "3.0-match",
            "input_size": input_size,
            "hidden_size": args.hidden_size,
            "num_layers": args.num_layers,
            "output_size": NUM_ABS,
            "abstract_actions": list(ABSTRACT_ACTIONS),
            "episodes": episode,
            "win_rate_vs_random": round(wr, 4),
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        export_weights(net, args.output, meta)


if __name__ == "__main__":
    main()
