"""
REINFORCE self-play trainer for 3-player Imposter Zero.

Trains a small policy MLP via self-play with policy gradient (REINFORCE with
baseline). All 3 players share one network since the game is symmetric modulo
player index. Uses the bucketed abstract action space (10 actions) from the
shared abstraction module.

Exports network weights as JSON for pure-TypeScript inference.

Usage:
  python train_neural.py --episodes 200000 --output ./training/policy_3p.json
"""

import argparse
import json
import math
import os
import random
import time

import torch
import torch.nn as nn
import torch.nn.functional as F
import pyspiel

import imposter_zero.game  # noqa: F401
from imposter_zero.abstraction import (
    ABSTRACT_ACTIONS,
    enriched_obs,
    enriched_obs_size,
    group_legal_by_abstract,
)

NUM_ABSTRACT_ACTIONS = len(ABSTRACT_ACTIONS)
ABS_TO_IDX = {a: i for i, a in enumerate(ABSTRACT_ACTIONS)}


class PolicyNet(nn.Module):
    def __init__(self, input_size=30, hidden_size=128, output_size=NUM_ABSTRACT_ACTIONS):
        super().__init__()
        self.fc1 = nn.Linear(input_size, hidden_size)
        self.fc2 = nn.Linear(hidden_size, output_size)

    def forward(self, x):
        x = F.relu(self.fc1(x))
        return self.fc2(x)


def select_action(net, state, player, device):
    """Forward pass -> masked softmax -> sample abstract action.

    Returns (abstract_key, log_prob, entropy, concrete_encoded_action).
    """
    legal = state.legal_actions()
    groups = group_legal_by_abstract(state, legal, player)
    available = list(groups.keys())

    obs = enriched_obs(state, player)
    obs_t = torch.tensor(obs, dtype=torch.float32, device=device).unsqueeze(0)

    logits = net(obs_t).squeeze(0)

    mask = torch.full((NUM_ABSTRACT_ACTIONS,), float("-inf"), device=device)
    for a in available:
        idx = ABS_TO_IDX.get(a)
        if idx is not None:
            mask[idx] = 0.0

    masked_logits = logits + mask
    probs = F.softmax(masked_logits, dim=0)
    dist = torch.distributions.Categorical(probs)
    sampled_idx = dist.sample()
    log_prob = dist.log_prob(sampled_idx)
    entropy = dist.entropy()

    chosen_abs = ABSTRACT_ACTIONS[sampled_idx.item()]
    concrete_options = groups.get(chosen_abs, legal)
    concrete = random.choice(concrete_options)

    return chosen_abs, log_prob, entropy, concrete


def play_episode(game, net, device):
    """Self-play one full game, return per-player trajectories."""
    state = game.new_initial_state()
    trajectories = {p: [] for p in range(game.num_players())}

    while not state.is_terminal():
        player = state.current_player()
        _, log_prob, ent, concrete = select_action(net, state, player, device)
        trajectories[player].append((log_prob, ent))
        state.apply_action(concrete)

    returns = state.returns()
    return trajectories, returns


def compute_loss(trajectories, returns, entropy_coeff, num_players):
    """REINFORCE loss with entropy bonus, aggregated across all players."""
    policy_loss = torch.tensor(0.0)
    entropy_bonus = torch.tensor(0.0)
    n_steps = 0

    for player in range(num_players):
        reward = returns[player]
        for log_prob, ent in trajectories[player]:
            policy_loss = policy_loss - reward * log_prob
            entropy_bonus = entropy_bonus + ent
            n_steps += 1

    if n_steps > 0:
        policy_loss = policy_loss / n_steps
        entropy_bonus = entropy_bonus / n_steps

    return policy_loss - entropy_coeff * entropy_bonus


def evaluate_vs_random(game, net, device, num_games=2000):
    """Evaluate the network (as player 0) against 2 random opponents."""
    wins = 0
    net.eval()
    with torch.no_grad():
        for _ in range(num_games):
            state = game.new_initial_state()
            while not state.is_terminal():
                player = state.current_player()
                if player == 0:
                    _, _, _, concrete = select_action(net, state, player, device)
                    state.apply_action(concrete)
                else:
                    state.apply_action(random.choice(state.legal_actions()))
            if state.returns()[0] > 0:
                wins += 1
    net.train()
    return wins / num_games


def export_weights(net, output_path, metadata):
    """Export network weights as JSON for TypeScript inference."""
    sd = net.state_dict()
    payload = {
        "metadata": metadata,
        "weights": {
            "w1": sd["fc1.weight"].cpu().tolist(),
            "b1": sd["fc1.bias"].cpu().tolist(),
            "w2": sd["fc2.weight"].cpu().tolist(),
            "b2": sd["fc2.bias"].cpu().tolist(),
        },
    }
    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(payload, f)
    size_kb = os.path.getsize(output_path) / 1024
    print(f"  -> Exported: {size_kb:.1f} KB -> {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Train 3p Imposter Zero via REINFORCE self-play")
    parser.add_argument("--episodes", type=int, default=200_000)
    parser.add_argument("--batch_size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--entropy_coeff", type=float, default=0.02)
    parser.add_argument("--hidden_size", type=int, default=128)
    parser.add_argument("--output", type=str, default="./training/policy_3p.json")
    parser.add_argument("--eval_every", type=int, default=10_000)
    parser.add_argument("--eval_games", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)
        torch.manual_seed(args.seed)

    device = torch.device("cpu")

    game = pyspiel.load_game("imposter_zero_3p")
    input_size = enriched_obs_size()
    net = PolicyNet(input_size, args.hidden_size, NUM_ABSTRACT_ACTIONS).to(device)
    optimizer = torch.optim.Adam(net.parameters(), lr=args.lr)

    print(f"Imposter Zero 3p — REINFORCE Self-Play")
    print(f"  Device:     {device}")
    print(f"  Network:    {input_size} -> {args.hidden_size} -> {NUM_ABSTRACT_ACTIONS}")
    print(f"  Parameters: {sum(p.numel() for p in net.parameters()):,}")
    print(f"  Episodes:   {args.episodes:,}")
    print(f"  Batch:      {args.batch_size}")
    print(f"  LR:         {args.lr}")
    print(f"  Entropy:    {args.entropy_coeff}")
    print()

    start_time = time.time()
    last_report = start_time
    episode = 0
    best_wr = 0.0

    while episode < args.episodes:
        batch_loss = torch.tensor(0.0, device="cpu")

        for _ in range(args.batch_size):
            trajectories, returns = play_episode(game, net, device)
            loss = compute_loss(trajectories, returns, args.entropy_coeff, game.num_players())
            batch_loss = batch_loss + loss
            episode += 1

        batch_loss = batch_loss / args.batch_size
        optimizer.zero_grad()
        batch_loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
        optimizer.step()

        now = time.time()
        if now - last_report >= 5.0 or episode >= args.episodes:
            elapsed = now - start_time
            rate = episode / elapsed
            eta = (args.episodes - episode) / rate if rate > 0 else 0
            print(
                f"  ep {episode:>8,} / {args.episodes:,}"
                f"  |  {rate:,.0f} ep/s"
                f"  |  loss: {batch_loss.item():.4f}"
                f"  |  elapsed: {elapsed:.0f}s"
                f"  |  ETA: {eta:.0f}s"
            )
            last_report = now

        if episode % args.eval_every < args.batch_size:
            wr = evaluate_vs_random(game, net, device, args.eval_games)
            print(f"  ** eval @ {episode:,}: win rate vs random = {wr:.1%}")
            if wr > best_wr:
                best_wr = wr
                export_weights(net, args.output, {
                    "algorithm": "reinforce_self_play",
                    "num_players": 3,
                    "input_size": input_size,
                    "hidden_size": args.hidden_size,
                    "output_size": NUM_ABSTRACT_ACTIONS,
                    "abstract_actions": ABSTRACT_ACTIONS,
                    "episodes": episode,
                    "win_rate_vs_random": round(wr, 4),
                    "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })

    print()
    elapsed = time.time() - start_time
    print(f"Training complete: {episode:,} episodes in {elapsed:.1f}s")

    wr = evaluate_vs_random(game, net, device, args.eval_games)
    print(f"Final win rate vs random: {wr:.1%}")
    print(f"Best win rate: {best_wr:.1%}")

    export_weights(net, args.output, {
        "algorithm": "reinforce_self_play",
        "num_players": 3,
        "input_size": input_size,
        "hidden_size": args.hidden_size,
        "output_size": NUM_ABSTRACT_ACTIONS,
        "abstract_actions": ABSTRACT_ACTIONS,
        "episodes": episode,
        "win_rate_vs_random": round(wr, 4),
        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })


if __name__ == "__main__":
    main()
