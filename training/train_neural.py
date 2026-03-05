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
    def __init__(self, input_size=30, hidden_size=128, output_size=NUM_ABSTRACT_ACTIONS, num_layers=2):
        super().__init__()
        layers = [nn.Linear(input_size, hidden_size), nn.ReLU()]
        for _ in range(num_layers - 2):
            layers += [nn.Linear(hidden_size, hidden_size), nn.ReLU()]
        layers.append(nn.Linear(hidden_size, output_size))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


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


def select_action_from_policy(state, player, policy_data):
    """Pick an action using a loaded JSON policy (no gradients)."""
    legal = state.legal_actions()
    groups = group_legal_by_abstract(state, legal, player)
    abs_actions = list(groups.keys())

    obs = enriched_obs(state, player)
    weights = policy_data["weights"]

    x = obs
    layer_idx = 1
    while f"w{layer_idx}" in weights:
        w = weights[f"w{layer_idx}"]
        b = weights[f"b{layer_idx}"]
        is_last = f"w{layer_idx + 1}" not in weights
        new_x = []
        for i in range(len(w)):
            val = b[i] + sum(w[i][j] * x[j] for j in range(len(x)))
            new_x.append(val if is_last else max(0.0, val))
        x = new_x
        layer_idx += 1

    action_list = policy_data["metadata"]["abstract_actions"]
    logits = x

    best_val = float("-inf")
    best_abs = abs_actions[0]
    for a in abs_actions:
        idx = action_list.index(a) if a in action_list else -1
        val = logits[idx] if 0 <= idx < len(logits) else 0.0
        if val > best_val:
            best_val = val
            best_abs = a

    import math
    exp_vals = {}
    for a in abs_actions:
        idx = action_list.index(a) if a in action_list else -1
        raw = logits[idx] if 0 <= idx < len(logits) else 0.0
        exp_vals[a] = math.exp(raw - best_val)
    total = sum(exp_vals.values())
    probs = [exp_vals[a] / total for a in abs_actions]

    chosen_abs = random.choices(abs_actions, weights=probs, k=1)[0]
    return random.choice(groups[chosen_abs])


def play_episode(game, net, device, opponent_policies=None, training_seat=None):
    """Play one full game. If opponent_policies are provided, only the
    training_seat player uses the network; opponents use the loaded policies.
    With no opponents, all players share the network (self-play).
    """
    state = game.new_initial_state()
    n = game.num_players()
    trajectories = {p: [] for p in range(n)}

    while not state.is_terminal():
        player = state.current_player()

        if opponent_policies and player != training_seat:
            opp_idx = player if player < training_seat else player - 1
            if opp_idx < len(opponent_policies) and opponent_policies[opp_idx] is not None:
                concrete = select_action_from_policy(state, player, opponent_policies[opp_idx])
            else:
                concrete = random.choice(state.legal_actions())
            state.apply_action(concrete)
            continue

        _, log_prob, ent, concrete = select_action(net, state, player, device)
        trajectories[player].append((log_prob, ent))
        state.apply_action(concrete)

    returns = state.returns()
    return trajectories, returns


def compute_loss(trajectories, returns, entropy_coeff, num_players, training_seat=None):
    """REINFORCE loss with entropy bonus. If training_seat is set, only
    accumulate gradients for that player."""
    policy_loss = torch.tensor(0.0)
    entropy_bonus = torch.tensor(0.0)
    n_steps = 0

    players = [training_seat] if training_seat is not None else range(num_players)
    for player in players:
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
    """Export network weights as JSON for TypeScript inference.

    Serializes all linear layers as w1/b1, w2/b2, ... wN/bN regardless of
    how deep the network is.
    """
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


def _extract_weight_pairs(rw):
    """Extract (weight_matrix, bias_vector) pairs from a policy JSON weights dict.

    Handles two formats:
      - Standard: w1/b1, w2/b2, ...  (new export code)
      - Legacy:   b1/w2, b2/w3, ...  (old sorted-key export with alphabetical bias-before-weight bug)
    """
    if "w1" in rw:
        pairs = []
        i = 1
        while f"w{i}" in rw:
            pairs.append((rw[f"w{i}"], rw.get(f"b{i}")))
            i += 1
        return pairs

    max_b = max((int(k[1:]) for k in rw if k.startswith("b")), default=0)
    max_w = max((int(k[1:]) for k in rw if k.startswith("w")), default=0)
    n_layers = max_b
    pairs = []
    for i in range(n_layers):
        w_key = f"w{i + 2}"
        b_key = f"b{i + 1}"
        pairs.append((rw.get(w_key), rw.get(b_key)))
    return pairs


def _load_opponent_policies(paths):
    """Load opponent policy JSONs. Returns list of parsed dicts (or None for random)."""
    opponents = []
    for p in paths:
        if p.lower() == "random":
            opponents.append(None)
        else:
            with open(p) as f:
                opponents.append(json.load(f))
            print(f"  Loaded opponent: {p}")
    return opponents


def _make_metadata(input_size, hidden_size, num_layers, episode, wr, opponents=None):
    meta = {
        "algorithm": "reinforce_self_play",
        "num_players": 3,
        "input_size": input_size,
        "hidden_size": hidden_size,
        "num_layers": num_layers,
        "output_size": NUM_ABSTRACT_ACTIONS,
        "abstract_actions": ABSTRACT_ACTIONS,
        "episodes": episode,
        "win_rate_vs_random": round(wr, 4),
        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if opponents:
        meta["trained_against"] = [
            p.get("metadata", {}).get("exported_at", "unknown") if p else "random"
            for p in opponents
        ]
    return meta


def main():
    parser = argparse.ArgumentParser(description="Train 3p Imposter Zero via REINFORCE self-play")
    parser.add_argument("--episodes", type=int, default=200_000)
    parser.add_argument("--max_time", type=int, default=0, help="Max wall-time in seconds (0 = unlimited)")
    parser.add_argument("--patience", type=int, default=0, help="Stop after N evals without improvement (0 = disabled)")
    parser.add_argument("--batch_size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--entropy_coeff", type=float, default=0.02)
    parser.add_argument("--hidden_size", type=int, default=128)
    parser.add_argument("--num_layers", type=int, default=2)
    parser.add_argument("--output", type=str, default="./training/policy_3p.json")
    parser.add_argument("--eval_every", type=int, default=10_000)
    parser.add_argument("--eval_games", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--opponents", type=str, nargs="*", default=None,
                        help="Paths to opponent policy JSONs (or 'random'). Training player rotates seats.")
    parser.add_argument("--resume", type=str, default=None,
                        help="Path to policy JSON to load weights from (fine-tuning). Must match architecture.")
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)
        torch.manual_seed(args.seed)

    device = torch.device("cpu")
    opponent_policies = _load_opponent_policies(args.opponents) if args.opponents else None
    mode = "vs-opponents" if opponent_policies else "self-play"
    if args.resume:
        mode = f"fine-tune ({mode})"

    game = pyspiel.load_game("imposter_zero_3p")
    n_players = game.num_players()
    input_size = enriched_obs_size()
    net = PolicyNet(input_size, args.hidden_size, NUM_ABSTRACT_ACTIONS, args.num_layers).to(device)

    if args.resume:
        with open(args.resume) as f:
            resume_data = json.load(f)
        rw = resume_data["weights"]

        wb_pairs = _extract_weight_pairs(rw)
        sd = net.state_dict()
        linear_keys = [(k.rsplit(".", 1)[0], k) for k in sd if k.endswith(".weight")]
        linear_keys.sort(key=lambda t: t[1])
        if len(wb_pairs) != len(linear_keys):
            raise ValueError(f"Resume weight count ({len(wb_pairs)}) != network layers ({len(linear_keys)})")
        for (w_data, b_data), (prefix, wkey) in zip(wb_pairs, linear_keys):
            sd[wkey] = torch.tensor(w_data)
            bkey = prefix + ".bias"
            if bkey in sd and b_data is not None:
                sd[bkey] = torch.tensor(b_data)
        net.load_state_dict(sd)
        print(f"  Resumed from: {args.resume}")

    optimizer = torch.optim.Adam(net.parameters(), lr=args.lr)

    time_limit = f"{args.max_time}s" if args.max_time > 0 else "unlimited"
    patience_str = str(args.patience) if args.patience > 0 else "disabled"

    print(f"Imposter Zero 3p — REINFORCE ({mode})")
    print(f"  Device:     {device}")
    print(f"  Network:    {input_size} -> {'x'.join([str(args.hidden_size)] * (args.num_layers - 1))} -> {NUM_ABSTRACT_ACTIONS} ({args.num_layers} layers)")
    print(f"  Parameters: {sum(p.numel() for p in net.parameters()):,}")
    print(f"  Max eps:    {args.episodes:,}")
    print(f"  Time limit: {time_limit}")
    print(f"  Patience:   {patience_str}")
    print(f"  Batch:      {args.batch_size}")
    print(f"  LR:         {args.lr}")
    print(f"  Entropy:    {args.entropy_coeff}")
    if opponent_policies:
        for i, op in enumerate(opponent_policies):
            label = "random" if op is None else op.get("metadata", {}).get("algorithm", "neural")
            print(f"  Opponent {i}: {label}")
    print()

    start_time = time.time()
    last_report = start_time
    episode = 0
    best_wr = 0.0
    evals_without_improvement = 0
    stop_reason = "max_episodes"

    while episode < args.episodes:
        if args.max_time > 0 and (time.time() - start_time) >= args.max_time:
            stop_reason = "time_limit"
            break

        batch_loss = torch.tensor(0.0, device="cpu")

        for b in range(args.batch_size):
            training_seat = (episode + b) % n_players if opponent_policies else None
            trajectories, returns = play_episode(
                game, net, device, opponent_policies, training_seat,
            )
            loss = compute_loss(
                trajectories, returns, args.entropy_coeff, n_players, training_seat,
            )
            batch_loss = batch_loss + loss
            episode += 1

        batch_loss = batch_loss / args.batch_size
        optimizer.zero_grad()
        batch_loss.backward()
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
                f"  |  loss: {batch_loss.item():.4f}"
                f"  |  best: {best_wr:.1%}"
                f"  |  stale: {evals_without_improvement}"
                f"  |  elapsed: {elapsed:.0f}s"
                f"  |  {eta_str}"
            )
            last_report = now

        if episode % args.eval_every < args.batch_size:
            wr = evaluate_vs_random(game, net, device, args.eval_games)
            print(f"  ** eval @ {episode:,}: win rate vs random = {wr:.1%}")
            if wr > best_wr:
                best_wr = wr
                evals_without_improvement = 0
                meta = _make_metadata(input_size, args.hidden_size, args.num_layers, episode, wr, opponent_policies)
                export_weights(net, args.output, meta)
            else:
                evals_without_improvement += 1

            if args.patience > 0 and evals_without_improvement >= args.patience:
                stop_reason = f"early_stop (no improvement for {args.patience} evals)"
                print(f"  !! Early stopping: {evals_without_improvement} evals without improvement")
                break

    elapsed = time.time() - start_time
    print()
    print(f"Training finished: {episode:,} episodes in {elapsed:.1f}s ({stop_reason})")

    wr = evaluate_vs_random(game, net, device, args.eval_games)
    print(f"Final win rate vs random: {wr:.1%}")
    print(f"Best win rate: {best_wr:.1%}")

    if wr >= best_wr:
        meta = _make_metadata(input_size, args.hidden_size, args.num_layers, episode, wr, opponent_policies)
        export_weights(net, args.output, meta)


if __name__ == "__main__":
    main()
