"""
PPO trainer with league training, curriculum, and comprehensive evaluation.

Improvements over train_raw_gpu.py:
- PPO algorithm (clipped objective + value network + GAE)
- League training (play against past checkpoints)
- Curriculum (random -> self-play -> league)
- Evaluation vs frozen checkpoint, abstract policy, and random
- Async workers for better throughput

Usage:
  python train_ppo.py --max_time 28800 --output ./training/policy_ppo.json
"""

import argparse
import copy
import gc
import json
import os
import pickle
import random
import time
from collections import deque
from multiprocessing import Pool, Queue, Process, set_start_method
from typing import Optional, List, Dict, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F
import pyspiel

import imposter_zero.game as ig  # noqa: F401 — registers games

NUM_ACTIONS = ig._DIMS_MATCH["num_actions"]
MAX_CARD_ID = ig._DIMS_MATCH["max_card_id"]
SPAN = MAX_CARD_ID + 1


# ---------------------------------------------------------------------------
# Observation (same as train_raw_gpu.py)
# ---------------------------------------------------------------------------

def _obs_size():
    return (
        3       # active_player one-hot
        + 7     # phase one-hot
        + SPAN  # hand binary
        + SPAN  # court face-up binary
        + 1     # king_face_up
        + 1     # successor_set
        + 1     # dungeon_set
        + 1     # throne_value / 9
        + 1     # court_size / 15
        + 1     # accused_value / 9
        + 1     # forgotten_exists
        + 3     # first_player one-hot
        + 1     # opp_hand_size / 9
        + 1     # opp_king_up
        + 1     # antechamber / 5
        + 1     # condemned / 10
        + 1     # disgraced / 7
        + 1     # my_score / 7
        + 1     # opp_score / 7
        + 1     # rounds / 14
        + 1     # army_avail / 8
        + 1     # army_exhausted / 8
        + 3     # facet one-hot
    )


OBS_SIZE = _obs_size()


def raw_observation(state, player):
    """Card-identity-aware observation for raw action output."""
    n = state._num_players
    opp = (player + 1) % n

    active_oh = [0.0] * 3
    if state._active_player < 3:
        active_oh[state._active_player] = 1.0

    phase = state._phase
    phase_oh = [float(phase == p) for p in (
        "crown", "setup", "play", "mustering",
        "draft_select", "draft_order", "draft_pick",
    )]

    hand_bin = [0.0] * SPAN
    for cid in state._hands[player]:
        if 0 <= cid < SPAN:
            hand_bin[cid] = 1.0

    court_up = [0.0] * SPAN
    for cid, fu, _ in state._court:
        if fu and 0 <= cid < SPAN:
            court_up[cid] = 1.0

    king_up = float(state._king_face_up[player])
    succ_set = float(state._successors[player] is not None)
    dung_set = float(state._dungeons[player] is not None)
    throne = state._throne_value() / 9.0
    court_sz = len(state._court) / 15.0
    accused_val = (state._card_values.get(state._accused, 0) / 9.0) if state._accused is not None else 0.0
    forgotten = float(state._forgotten is not None)

    fp_oh = [0.0] * 3
    fp = getattr(state, "_first_player", 0)
    if fp < 3:
        fp_oh[fp] = 1.0

    opp_hand = len(state._hands[opp]) / 9.0
    opp_king = float(state._king_face_up[opp])

    ante = len(state._antechamber[player]) / 5.0
    condemned = len(state._condemned) / 10.0
    disgraced = sum(1 for _, fu, _ in state._court if not fu) / 7.0

    scores = getattr(state, "_match_scores", [0, 0])
    my_score = scores[player] / 7.0
    opp_score = scores[opp] / 7.0
    rounds = getattr(state, "_rounds_played", 0) / 14.0

    army_avail = len(getattr(state, "_army_ids", [[], []])[player]) / 8.0
    army_exh = len(getattr(state, "_exhausted_ids", [[], []])[player]) / 8.0

    facets = getattr(state, "_king_facets", ["default", "default"])
    facet_oh = [
        float(facets[player] == "default"),
        float(facets[player] == "masterTactician"),
        float(facets[player] == "charismatic"),
    ]

    return (
        active_oh + phase_oh + hand_bin + court_up +
        [king_up, succ_set, dung_set, throne, court_sz, accused_val, forgotten] +
        fp_oh + [opp_hand, opp_king] +
        [ante, condemned, disgraced] +
        [my_score, opp_score, rounds, army_avail, army_exh] +
        facet_oh
    )


# ---------------------------------------------------------------------------
# Actor-Critic Network (PPO requires value head)
# ---------------------------------------------------------------------------

class ActorCritic(nn.Module):
    def __init__(self, input_size=OBS_SIZE, hidden_size=512, output_size=NUM_ACTIONS, num_layers=4):
        super().__init__()
        # Shared layers
        shared = [nn.Linear(input_size, hidden_size), nn.ReLU()]
        for _ in range(num_layers - 2):
            shared += [nn.Linear(hidden_size, hidden_size), nn.ReLU()]
        self.shared = nn.Sequential(*shared)

        # Policy head
        self.policy_head = nn.Linear(hidden_size, output_size)

        # Value head
        self.value_head = nn.Linear(hidden_size, 1)

    def forward(self, x):
        features = self.shared(x)
        return self.policy_head(features), self.value_head(features).squeeze(-1)

    def policy(self, x):
        features = self.shared(x)
        return self.policy_head(features)

    def value(self, x):
        features = self.shared(x)
        return self.value_head(features).squeeze(-1)


# For compatibility with existing code that expects PolicyNet
class PolicyNet(ActorCritic):
    pass


# ---------------------------------------------------------------------------
# League: collection of past checkpoints
# ---------------------------------------------------------------------------

class League:
    def __init__(self, max_size: int = 20):
        self.max_size = max_size
        self.checkpoints: List[Tuple[int, bytes, float]] = []  # (episode, weights_bytes, win_rate)

    def add(self, episode: int, weights_bytes: bytes, win_rate: float):
        """Add a checkpoint to the league."""
        self.checkpoints.append((episode, weights_bytes, win_rate))
        # Keep only the most recent + best performers
        if len(self.checkpoints) > self.max_size:
            # Sort by win_rate, keep top half + most recent half
            by_wr = sorted(self.checkpoints, key=lambda x: x[2], reverse=True)
            by_ep = sorted(self.checkpoints, key=lambda x: x[0], reverse=True)
            keep = set()
            for i in range(self.max_size // 2):
                if i < len(by_wr):
                    keep.add(by_wr[i][0])
                if i < len(by_ep):
                    keep.add(by_ep[i][0])
            self.checkpoints = [c for c in self.checkpoints if c[0] in keep][:self.max_size]

    def sample(self) -> Optional[bytes]:
        """Sample a checkpoint, biased toward recent/strong."""
        if not self.checkpoints:
            return None
        # Weight by recency (more recent = higher weight)
        weights = [i + 1 for i in range(len(self.checkpoints))]
        total = sum(weights)
        probs = [w / total for w in weights]
        idx = random.choices(range(len(self.checkpoints)), weights=probs, k=1)[0]
        return self.checkpoints[idx][1]

    def __len__(self):
        return len(self.checkpoints)


# ---------------------------------------------------------------------------
# Opponent types for curriculum
# ---------------------------------------------------------------------------

class OpponentType:
    SELF = "self"       # Current policy (self-play)
    RANDOM = "random"   # Random actions
    LEAGUE = "league"   # Past checkpoint from league


def select_opponent(episode: int, curriculum_random_until: int,
                    curriculum_self_until: int, league: League) -> str:
    """Select opponent type based on curriculum and training progress."""
    if episode < curriculum_random_until:
        # Phase 1: Mix self-play with random
        return OpponentType.RANDOM if random.random() < 0.5 else OpponentType.SELF
    elif episode < curriculum_self_until or len(league) == 0:
        # Phase 2: Pure self-play
        return OpponentType.SELF
    else:
        # Phase 3: League training (70% league, 30% self-play)
        return OpponentType.LEAGUE if random.random() < 0.7 else OpponentType.SELF


# ---------------------------------------------------------------------------
# Worker: simulate episodes with opponent selection
# ---------------------------------------------------------------------------

def _worker_simulate_ppo(args):
    """
    Simulate episodes for PPO. Returns trajectories with log_probs and values.
    """
    (weights_bytes, opponent_weights_bytes, opponent_type, n_episodes, seed,
     input_size, hidden_size, num_layers, num_actions) = args

    net = ActorCritic(input_size, hidden_size, num_actions, num_layers)
    net.load_state_dict(pickle.loads(weights_bytes))
    net.eval()

    # Load opponent network if needed
    opp_net = None
    if opponent_type == OpponentType.LEAGUE and opponent_weights_bytes is not None:
        opp_net = ActorCritic(input_size, hidden_size, num_actions, num_layers)
        opp_net.load_state_dict(pickle.loads(opponent_weights_bytes))
        opp_net.eval()

    game = pyspiel.load_game("imposter_zero_match")
    rng = random.Random(seed)
    results = []

    for _ in range(n_episodes):
        state = game.new_initial_state()
        # Trajectory for player 0 (the learner)
        obs_list = []
        act_list = []
        log_prob_list = []
        value_list = []
        player_list = []
        legal_list = []

        while not state.is_terminal():
            player = state.current_player()
            if player < 0:
                break

            legal = state.legal_actions()
            if not legal:
                break

            obs = raw_observation(state, player)

            if player == 0:
                # Learner always uses current policy
                with torch.no_grad():
                    obs_t = torch.tensor([obs], dtype=torch.float32)
                    logits, value = net(obs_t)
                    logits = logits.squeeze(0).clamp(-50, 50)
                    value = value.item()

                mask = torch.full((num_actions,), -1e9)
                for a in legal:
                    mask[a] = 0.0

                masked_logits = logits + mask
                probs = F.softmax(masked_logits, dim=0)
                log_probs = F.log_softmax(masked_logits, dim=0)
                action = torch.multinomial(probs, 1).item()
                log_prob = log_probs[action].item()

                obs_list.append(obs)
                act_list.append(action)
                log_prob_list.append(log_prob)
                value_list.append(value)
                player_list.append(player)
                legal_list.append(legal)

            else:
                # Opponent selection
                if opponent_type == OpponentType.RANDOM:
                    action = rng.choice(legal)
                elif opponent_type == OpponentType.LEAGUE and opp_net is not None:
                    with torch.no_grad():
                        obs_t = torch.tensor([obs], dtype=torch.float32)
                        logits = opp_net.policy(obs_t).squeeze(0).clamp(-50, 50)
                    mask = torch.full((num_actions,), -1e9)
                    for a in legal:
                        mask[a] = 0.0
                    probs = F.softmax(logits + mask, dim=0)
                    action = torch.multinomial(probs, 1).item()
                else:
                    # Self-play: same policy
                    with torch.no_grad():
                        obs_t = torch.tensor([obs], dtype=torch.float32)
                        logits = net.policy(obs_t).squeeze(0).clamp(-50, 50)
                    mask = torch.full((num_actions,), -1e9)
                    for a in legal:
                        mask[a] = 0.0
                    probs = F.softmax(logits + mask, dim=0)
                    action = torch.multinomial(probs, 1).item()

            state.apply_action(action)

        returns = state.returns() if state.is_terminal() else [0.0, 0.0]
        # Only return trajectory for player 0 (learner)
        results.append((obs_list, act_list, log_prob_list, value_list,
                       player_list, legal_list, returns[0]))

    return results


# ---------------------------------------------------------------------------
# GAE (Generalized Advantage Estimation)
# ---------------------------------------------------------------------------

def compute_gae(rewards: List[float], values: List[float],
                gamma: float = 0.99, lam: float = 0.95) -> Tuple[List[float], List[float]]:
    """
    Compute GAE advantages and returns.
    For episodic games, the final value is 0.
    """
    advantages = []
    returns = []
    gae = 0.0

    # Append 0 for terminal state value
    values = values + [0.0]

    # Single reward at end of episode
    step_rewards = [0.0] * (len(values) - 2) + [rewards] if isinstance(rewards, float) else rewards
    if len(step_rewards) < len(values) - 1:
        step_rewards = [0.0] * (len(values) - 1 - 1) + [rewards if isinstance(rewards, float) else rewards[-1]]

    for t in reversed(range(len(values) - 1)):
        r = step_rewards[t] if t < len(step_rewards) else 0.0
        delta = r + gamma * values[t + 1] - values[t]
        gae = delta + gamma * lam * gae
        advantages.insert(0, gae)
        returns.insert(0, gae + values[t])

    return advantages, returns


# ---------------------------------------------------------------------------
# Evaluation functions
# ---------------------------------------------------------------------------

def evaluate_vs_random(game, net, device, num_games=1000):
    """Evaluate win rate against random opponent."""
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
                    if not legal:
                        break
                    obs = raw_observation(state, player)
                    obs_t = torch.tensor([obs], dtype=torch.float32, device=device)
                    logits = net.policy(obs_t).squeeze(0).clamp(-50, 50)
                    mask = torch.full((NUM_ACTIONS,), -1e9, device=device)
                    for a in legal:
                        mask[a] = 0.0
                    probs = F.softmax(logits + mask, dim=0)
                    action = torch.multinomial(probs, 1).item()
                    state.apply_action(action)
                else:
                    state.apply_action(random.choice(state.legal_actions()))
                steps += 1
            if state.is_terminal() and state.returns()[0] > 0:
                wins += 1
    net.train()
    return wins / num_games


def evaluate_vs_frozen(game, current_net, frozen_net, device, num_games=500):
    """Evaluate win rate against a frozen checkpoint."""
    wins = 0
    current_net.eval()
    frozen_net.eval()
    with torch.no_grad():
        for _ in range(num_games):
            state = game.new_initial_state()
            steps = 0
            while not state.is_terminal() and steps < 800:
                player = state.current_player()
                if player < 0:
                    break
                legal = state.legal_actions()
                if not legal:
                    break
                obs = raw_observation(state, player)
                obs_t = torch.tensor([obs], dtype=torch.float32, device=device)

                if player == 0:
                    logits = current_net.policy(obs_t).squeeze(0).clamp(-50, 50)
                else:
                    logits = frozen_net.policy(obs_t).squeeze(0).clamp(-50, 50)

                mask = torch.full((NUM_ACTIONS,), -1e9, device=device)
                for a in legal:
                    mask[a] = 0.0
                probs = F.softmax(logits + mask, dim=0)
                action = torch.multinomial(probs, 1).item()
                state.apply_action(action)
                steps += 1
            if state.is_terminal() and state.returns()[0] > 0:
                wins += 1
    current_net.train()
    return wins / num_games


def evaluate_vs_abstract(game, raw_net, abstract_policy_path: str, device, num_games=500):
    """Evaluate raw network against abstract policy."""
    # Import abstract policy components
    try:
        from imposter_zero.abstraction import (
            ABSTRACT_ACTIONS, enriched_obs, group_legal_by_abstract
        )
    except ImportError:
        print("  Warning: Cannot import abstraction module, skipping vs-abstract eval")
        return None

    # Load abstract policy
    try:
        with open(abstract_policy_path) as f:
            abstract_data = json.load(f)
    except FileNotFoundError:
        print(f"  Warning: Abstract policy not found at {abstract_policy_path}")
        return None

    # Reconstruct abstract network
    meta = abstract_data.get("metadata", {})
    abs_input_size = meta.get("input_size", 43)
    abs_hidden_size = meta.get("hidden_size", 256)
    abs_num_layers = meta.get("num_layers", 3)
    abs_output_size = len(ABSTRACT_ACTIONS)

    class AbstractPolicyNet(nn.Module):
        def __init__(self):
            super().__init__()
            layers = [nn.Linear(abs_input_size, abs_hidden_size), nn.ReLU()]
            for _ in range(abs_num_layers - 2):
                layers += [nn.Linear(abs_hidden_size, abs_hidden_size), nn.ReLU()]
            layers.append(nn.Linear(abs_hidden_size, abs_output_size))
            self.net = nn.Sequential(*layers)

        def forward(self, x):
            return self.net(x)

    abs_net = AbstractPolicyNet()
    rw = abstract_data["weights"]
    sd = abs_net.state_dict()
    linear_keys = [(k.rsplit(".", 1)[0], k) for k in sd if k.endswith(".weight")]
    linear_keys.sort(key=lambda t: t[1])
    for i, (prefix, wkey) in enumerate(linear_keys):
        sd[wkey] = torch.tensor(rw[f"w{i+1}"])
        bkey = prefix + ".bias"
        if bkey in sd and f"b{i+1}" in rw:
            sd[bkey] = torch.tensor(rw[f"b{i+1}"])
    abs_net.load_state_dict(sd)
    abs_net.to(device)
    abs_net.eval()

    ABS_TO_IDX = {a: i for i, a in enumerate(ABSTRACT_ACTIONS)}

    wins = 0
    raw_net.eval()
    with torch.no_grad():
        for _ in range(num_games):
            state = game.new_initial_state()
            steps = 0
            while not state.is_terminal() and steps < 800:
                player = state.current_player()
                if player < 0:
                    break
                legal = state.legal_actions()
                if not legal:
                    break

                if player == 0:
                    # Raw network
                    obs = raw_observation(state, player)
                    obs_t = torch.tensor([obs], dtype=torch.float32, device=device)
                    logits = raw_net.policy(obs_t).squeeze(0).clamp(-50, 50)
                    mask = torch.full((NUM_ACTIONS,), -1e9, device=device)
                    for a in legal:
                        mask[a] = 0.0
                    probs = F.softmax(logits + mask, dim=0)
                    action = torch.multinomial(probs, 1).item()
                else:
                    # Abstract network
                    groups = group_legal_by_abstract(state, legal, player)
                    available = list(groups.keys())
                    obs = enriched_obs(state, player)
                    obs_t = torch.tensor([obs], dtype=torch.float32, device=device)
                    logits = abs_net(obs_t).squeeze(0)
                    mask = torch.full((abs_output_size,), float("-inf"), device=device)
                    for a in available:
                        idx = ABS_TO_IDX.get(a)
                        if idx is not None:
                            mask[idx] = 0.0
                    probs = F.softmax(logits + mask, dim=0)
                    sampled_idx = torch.multinomial(probs, 1).item()
                    chosen_abs = ABSTRACT_ACTIONS[sampled_idx]
                    concrete_options = groups.get(chosen_abs, legal)
                    action = random.choice(concrete_options)

                state.apply_action(action)
                steps += 1
            if state.is_terminal() and state.returns()[0] > 0:
                wins += 1
    raw_net.train()
    return wins / num_games


# ---------------------------------------------------------------------------
# Memory management
# ---------------------------------------------------------------------------

def cleanup_memory(device):
    gc.collect()
    if device.type == "mps":
        torch.mps.empty_cache()
    elif device.type == "cuda":
        torch.cuda.empty_cache()


# ---------------------------------------------------------------------------
# Export weights as JSON
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
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"  -> Exported: {size_mb:.1f} MB -> {output_path}", flush=True)


# ---------------------------------------------------------------------------
# Main training loop
# ---------------------------------------------------------------------------

def main():
    try:
        set_start_method("spawn")
    except RuntimeError:
        pass

    parser = argparse.ArgumentParser(description="PPO trainer with league and curriculum")
    # Training parameters
    parser.add_argument("--episodes", type=int, default=5_000_000)
    parser.add_argument("--max_time", type=int, default=0)
    parser.add_argument("--num_workers", type=int, default=12)
    parser.add_argument("--episodes_per_worker", type=int, default=12)

    # Network architecture
    parser.add_argument("--hidden_size", type=int, default=512)
    parser.add_argument("--num_layers", type=int, default=4)

    # PPO hyperparameters
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--entropy_coeff", type=float, default=0.05,
                        help="Entropy coefficient (0.05-0.2 recommended by Rudolph et al.)")
    parser.add_argument("--clip_ratio", type=float, default=0.2)
    parser.add_argument("--value_coeff", type=float, default=0.5)
    parser.add_argument("--gamma", type=float, default=0.99)
    parser.add_argument("--gae_lambda", type=float, default=0.95)
    parser.add_argument("--ppo_epochs", type=int, default=4,
                        help="Number of PPO update epochs per batch")
    parser.add_argument("--minibatch_size", type=int, default=4096)

    # Curriculum parameters
    parser.add_argument("--curriculum_random_until", type=int, default=10_000,
                        help="Mix random opponents until this episode count")
    parser.add_argument("--curriculum_self_until", type=int, default=50_000,
                        help="Pure self-play until this episode count, then league")
    parser.add_argument("--league_size", type=int, default=20,
                        help="Maximum number of checkpoints in league")
    parser.add_argument("--league_add_every", type=int, default=20_000,
                        help="Add checkpoint to league every N episodes")

    # Evaluation parameters
    parser.add_argument("--eval_every", type=int, default=10_000)
    parser.add_argument("--eval_games", type=int, default=500)
    parser.add_argument("--frozen_update_every", type=int, default=50_000,
                        help="Update frozen checkpoint every N episodes")
    parser.add_argument("--abstract_policy", type=str,
                        default="./training/policy_match_neural.json",
                        help="Path to abstract policy for evaluation")

    # Output
    parser.add_argument("--output", type=str, default="./training/policy_ppo.json")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--patience", type=int, default=0)
    parser.add_argument("--resume", type=str, default=None)
    parser.add_argument("--max_batch_samples", type=int, default=50_000)
    parser.add_argument("--cleanup_every", type=int, default=100)

    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)
        torch.manual_seed(args.seed)

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    game = pyspiel.load_game("imposter_zero_match")

    # Initialize networks
    net = ActorCritic(OBS_SIZE, args.hidden_size, NUM_ACTIONS, args.num_layers).to(device)
    frozen_net = ActorCritic(OBS_SIZE, args.hidden_size, NUM_ACTIONS, args.num_layers).to(device)

    # Initialize league
    league = League(max_size=args.league_size)

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
        reps = resume_data.get("metadata", {}).get("episodes", 0)
        rwr = resume_data.get("metadata", {}).get("win_rate_vs_random", 0)
        print(f"  Resumed from: {args.resume} ({reps:,} eps, wr={rwr:.1%})")
    else:
        reps = 0
        rwr = 0.0

    # Copy to frozen
    frozen_net.load_state_dict(net.state_dict())

    optimizer = torch.optim.Adam(net.parameters(), lr=args.lr)
    batch_size = args.num_workers * args.episodes_per_worker
    n_params = sum(p.numel() for p in net.parameters())

    print(f"Imposter Zero 2p Match — PPO with League Training")
    print(f"  Device:      {device}")
    print(f"  Network:     {OBS_SIZE} -> {'x'.join([str(args.hidden_size)] * (args.num_layers - 1))} -> {NUM_ACTIONS} ({args.num_layers} layers)")
    print(f"  Parameters:  {n_params:,}")
    print(f"  Algorithm:   PPO (clip={args.clip_ratio}, ent={args.entropy_coeff})")
    print(f"  Curriculum:  random<{args.curriculum_random_until}, self<{args.curriculum_self_until}, then league")
    print(f"  League:      max {args.league_size} checkpoints, add every {args.league_add_every} eps")
    print(f"  Workers:     {args.num_workers} x {args.episodes_per_worker} eps/worker")
    print(f"  LR:          {args.lr}")
    print()

    start_time = time.time()
    last_report = start_time
    episode = reps
    best_wr_random = rwr
    best_wr_frozen = 0.5
    evals_without_improvement = 0
    stop_reason = "max_episodes"
    batch_count = 0
    last_frozen_update = 0
    last_league_add = 0

    pool = Pool(processes=args.num_workers)

    try:
        while episode < args.episodes:
            if args.max_time > 0 and (time.time() - start_time) >= args.max_time:
                stop_reason = "time_limit"
                break

            # Select opponent type based on curriculum
            opponent_type = select_opponent(
                episode, args.curriculum_random_until,
                args.curriculum_self_until, league
            )

            # Get opponent weights if using league
            opponent_weights = None
            if opponent_type == OpponentType.LEAGUE:
                opponent_weights = league.sample()
                if opponent_weights is None:
                    opponent_type = OpponentType.SELF

            net.cpu()
            weights_bytes = pickle.dumps(net.state_dict())
            net.to(device)

            base_seed = random.randint(0, 2**31)
            worker_args = [
                (weights_bytes, opponent_weights, opponent_type,
                 args.episodes_per_worker, base_seed + i,
                 OBS_SIZE, args.hidden_size, args.num_layers, NUM_ACTIONS)
                for i in range(args.num_workers)
            ]

            all_results = pool.map(_worker_simulate_ppo, worker_args)

            # Flatten trajectories
            flat_obs = []
            flat_acts = []
            flat_old_log_probs = []
            flat_values = []
            flat_returns = []
            flat_advantages = []
            flat_legal = []

            for worker_eps in all_results:
                for (obs_list, act_list, log_prob_list, value_list,
                     player_list, legal_list, final_return) in worker_eps:
                    if not obs_list:
                        continue

                    # Compute GAE for this trajectory
                    advantages, returns = compute_gae(
                        final_return, value_list, args.gamma, args.gae_lambda
                    )

                    for i, (obs, act, lp, val, legal) in enumerate(
                        zip(obs_list, act_list, log_prob_list, value_list, legal_list)
                    ):
                        flat_obs.append(obs)
                        flat_acts.append(act)
                        flat_old_log_probs.append(lp)
                        flat_values.append(val)
                        flat_returns.append(returns[i] if i < len(returns) else final_return)
                        flat_advantages.append(advantages[i] if i < len(advantages) else 0.0)
                        flat_legal.append(legal)

            episode += batch_size
            if not flat_obs:
                continue

            # Truncate if needed
            n_samples = len(flat_obs)
            if args.max_batch_samples > 0 and n_samples > args.max_batch_samples:
                indices = list(range(n_samples))
                random.shuffle(indices)
                indices = indices[:args.max_batch_samples]
                flat_obs = [flat_obs[i] for i in indices]
                flat_acts = [flat_acts[i] for i in indices]
                flat_old_log_probs = [flat_old_log_probs[i] for i in indices]
                flat_returns = [flat_returns[i] for i in indices]
                flat_advantages = [flat_advantages[i] for i in indices]
                flat_legal = [flat_legal[i] for i in indices]
                n_samples = args.max_batch_samples

            # Convert to tensors
            try:
                obs_t = torch.tensor(flat_obs, dtype=torch.float32, device=device)
                acts_t = torch.tensor(flat_acts, dtype=torch.long, device=device)
                old_log_probs_t = torch.tensor(flat_old_log_probs, dtype=torch.float32, device=device)
                returns_t = torch.tensor(flat_returns, dtype=torch.float32, device=device)
                advantages_t = torch.tensor(flat_advantages, dtype=torch.float32, device=device)

                # Normalize advantages
                advantages_t = (advantages_t - advantages_t.mean()) / (advantages_t.std() + 1e-8)

                # Build masks
                masks_t = torch.full((n_samples, NUM_ACTIONS), -1e9, device=device)
                for i, legal in enumerate(flat_legal):
                    masks_t[i, legal] = 0.0

                # PPO update epochs
                total_policy_loss = 0.0
                total_value_loss = 0.0
                total_entropy = 0.0

                for _ in range(args.ppo_epochs):
                    # Shuffle and create minibatches
                    indices = torch.randperm(n_samples, device=device)

                    for start in range(0, n_samples, args.minibatch_size):
                        end = min(start + args.minibatch_size, n_samples)
                        mb_idx = indices[start:end]

                        mb_obs = obs_t[mb_idx]
                        mb_acts = acts_t[mb_idx]
                        mb_old_lp = old_log_probs_t[mb_idx]
                        mb_returns = returns_t[mb_idx]
                        mb_adv = advantages_t[mb_idx]
                        mb_masks = masks_t[mb_idx]

                        # Forward pass
                        logits, values = net(mb_obs)
                        logits = logits.clamp(-50, 50)

                        # Policy loss (PPO clipped objective)
                        masked_logits = logits + mb_masks
                        log_probs = F.log_softmax(masked_logits, dim=1)
                        new_log_probs = log_probs.gather(1, mb_acts.unsqueeze(1)).squeeze(1)

                        ratio = torch.exp(new_log_probs - mb_old_lp)
                        surr1 = ratio * mb_adv
                        surr2 = torch.clamp(ratio, 1 - args.clip_ratio, 1 + args.clip_ratio) * mb_adv
                        policy_loss = -torch.min(surr1, surr2).mean()

                        # Value loss
                        value_loss = F.mse_loss(values, mb_returns)

                        # Entropy bonus
                        probs = F.softmax(masked_logits, dim=1)
                        entropy_terms = probs * log_probs
                        entropy = -torch.nan_to_num(entropy_terms, nan=0.0).sum(dim=1).mean()

                        # Total loss
                        loss = (policy_loss
                                + args.value_coeff * value_loss
                                - args.entropy_coeff * entropy)

                        optimizer.zero_grad()
                        loss.backward()
                        torch.nn.utils.clip_grad_norm_(net.parameters(), 0.5)
                        optimizer.step()

                        total_policy_loss += policy_loss.item()
                        total_value_loss += value_loss.item()
                        total_entropy += entropy.item()

                n_updates = args.ppo_epochs * ((n_samples + args.minibatch_size - 1) // args.minibatch_size)
                avg_policy_loss = total_policy_loss / n_updates
                avg_value_loss = total_value_loss / n_updates
                avg_entropy = total_entropy / n_updates

            except RuntimeError as e:
                if "out of memory" in str(e).lower() or "MPS" in str(e):
                    print(f"  !! OOM at ep {episode}, clearing memory...", flush=True)
                    cleanup_memory(device)
                    continue
                raise

            # Memory cleanup
            batch_count += 1
            if batch_count % args.cleanup_every == 0:
                cleanup_memory(device)

            # Progress report
            now = time.time()
            if now - last_report >= 10.0 or episode >= args.episodes:
                elapsed = now - start_time
                rate = episode / elapsed
                remaining = max(0, args.max_time - elapsed) if args.max_time > 0 else (args.episodes - episode) / rate if rate > 0 else 0
                tag = "remaining" if args.max_time > 0 else "ETA"
                opp_tag = opponent_type[0].upper()  # S/R/L
                print(
                    f"  ep {episode:>9,}"
                    f"  |  {rate:,.0f} ep/s"
                    f"  |  π:{avg_policy_loss:.4f}"
                    f"  |  v:{avg_value_loss:.4f}"
                    f"  |  ent:{avg_entropy:.3f}"
                    f"  |  opp:{opp_tag}"
                    f"  |  lg:{len(league)}"
                    f"  |  best:{best_wr_random:.1%}"
                    f"  |  {tag}:{remaining:.0f}s",
                    flush=True,
                )
                last_report = now

            # Add to league periodically
            if episode - last_league_add >= args.league_add_every:
                net.cpu()
                league.add(episode, pickle.dumps(net.state_dict()), best_wr_random)
                net.to(device)
                last_league_add = episode
                print(f"  ++ Added checkpoint to league (size: {len(league)})", flush=True)

            # Update frozen checkpoint periodically
            if episode - last_frozen_update >= args.frozen_update_every:
                frozen_net.load_state_dict(net.state_dict())
                last_frozen_update = episode
                print(f"  ++ Updated frozen checkpoint", flush=True)

            # Evaluation
            if episode % args.eval_every < batch_size:
                net.cpu()

                # vs random
                wr_random = evaluate_vs_random(game, net, torch.device("cpu"), args.eval_games)
                print(f"  ** eval @ {episode:,}: vs random = {wr_random:.1%}", flush=True)

                # vs frozen
                frozen_net.cpu()
                wr_frozen = evaluate_vs_frozen(game, net, frozen_net, torch.device("cpu"), args.eval_games // 2)
                frozen_net.to(device)
                print(f"  ** eval @ {episode:,}: vs frozen = {wr_frozen:.1%}", flush=True)

                # vs abstract (if available)
                if os.path.exists(args.abstract_policy):
                    wr_abstract = evaluate_vs_abstract(
                        game, net, args.abstract_policy, torch.device("cpu"), args.eval_games // 2
                    )
                    if wr_abstract is not None:
                        print(f"  ** eval @ {episode:,}: vs abstract = {wr_abstract:.1%}", flush=True)

                net.to(device)

                if wr_random > best_wr_random:
                    best_wr_random = wr_random
                    evals_without_improvement = 0
                    meta = {
                        "algorithm": "ppo_league_curriculum",
                        "action_space": "raw",
                        "num_players": 2,
                        "game": "imposter_zero_match",
                        "game_version": "3.0-match-ppo",
                        "input_size": OBS_SIZE,
                        "hidden_size": args.hidden_size,
                        "num_layers": args.num_layers,
                        "output_size": NUM_ACTIONS,
                        "num_actions": NUM_ACTIONS,
                        "episodes": episode,
                        "win_rate_vs_random": round(wr_random, 4),
                        "win_rate_vs_frozen": round(wr_frozen, 4),
                        "entropy_coeff": args.entropy_coeff,
                        "clip_ratio": args.clip_ratio,
                        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    }
                    net.cpu()
                    export_weights(net, args.output, meta)
                    net.to(device)
                else:
                    evals_without_improvement += 1

                best_wr_frozen = max(best_wr_frozen, wr_frozen)

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
    print(f"Best win rate vs random: {best_wr_random:.1%}")
    print(f"Best win rate vs frozen: {best_wr_frozen:.1%}")

    if wr >= best_wr_random:
        meta = {
            "algorithm": "ppo_league_curriculum",
            "action_space": "raw",
            "num_players": 2,
            "game": "imposter_zero_match",
            "game_version": "3.0-match-ppo",
            "input_size": OBS_SIZE,
            "hidden_size": args.hidden_size,
            "num_layers": args.num_layers,
            "output_size": NUM_ACTIONS,
            "num_actions": NUM_ACTIONS,
            "episodes": episode,
            "win_rate_vs_random": round(wr, 4),
            "entropy_coeff": args.entropy_coeff,
            "clip_ratio": args.clip_ratio,
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        export_weights(net, args.output, meta)


if __name__ == "__main__":
    main()
