"""
Blazing MK-II — True GPU-Parallelized Training

Key difference from MK-I: Vectorized game environment with batched GPU inference.

Architecture:
  1. VectorizedGames: N games stepped in lockstep
  2. Single batched forward pass per step (not per game)
  3. Gumbel search with batched candidate evaluation
  4. All NN calls go through GPU batch queue

Expected speedup: 10-30x over sequential MK-I

Usage:
  python train_blazing_mk_ii.py --max_time 3600 --n_envs 64 --n_simulations 4
"""

from __future__ import annotations

import argparse
import gc
import json
import math
import random
import time
from collections import deque
from dataclasses import dataclass, field
from itertools import combinations
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
# Compact Intent System
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class Intent:
    targets: FrozenSet[int]
    facet: Optional[str]


def get_intents(state, player: int) -> List[Intent]:
    """Enumerate feasible intents (cached externally)."""
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
    """Convert intent to action sequence."""
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
# Network (same as MK-I but with batch-optimized methods)
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
        self._init()

    def _init(self):
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
# Vectorized Game Environment
# ---------------------------------------------------------------------------

@dataclass
class EnvState:
    """Per-environment state."""
    game_state: object
    trajectory: List[Tuple]
    pending_actions: List[int] = field(default_factory=list)
    done: bool = False


class VectorizedGames:
    """
    N games running in parallel with batched NN evaluation.

    Key optimization: All games at the same decision point get their
    observations batched into a single GPU forward pass.
    """

    def __init__(
        self,
        n_envs: int,
        net: BlazingNet,
        device: torch.device,
        use_gumbel: bool = True,
        n_simulations: int = 4,
    ):
        self.n_envs = n_envs
        self.net = net
        self.device = device
        self.use_gumbel = use_gumbel
        self.n_sims = n_simulations

        self.game = pyspiel.load_game("imposter_zero_match")
        self.envs: List[EnvState] = []
        self._reset_all()

        # Intent cache
        self._intent_cache: Dict[int, List[Intent]] = {}

    def _reset_all(self):
        """Initialize/reset all environments."""
        self.envs = [
            EnvState(game_state=self.game.new_initial_state(), trajectory=[])
            for _ in range(self.n_envs)
        ]

    def _reset_env(self, idx: int):
        """Reset single environment."""
        self.envs[idx] = EnvState(
            game_state=self.game.new_initial_state(),
            trajectory=[],
        )

    def step_all(self) -> List[Tuple[List, float]]:
        """
        Step all environments until each reaches a player 0 decision or completes.

        Optimization: Batch opponent decisions, then batch player 0 decisions.
        Loop until all envs are at player 0 decision points.
        """
        completed = []
        max_waves = 20  # Safety limit on batching waves

        for _ in range(max_waves):
            # Classify all active envs
            player0_envs = []
            opponent_envs = []
            pending_envs = []  # Have pending actions to execute

            for i, env in enumerate(self.envs):
                if env.done:
                    continue

                state = env.game_state

                if state.is_terminal():
                    completed.append((env.trajectory, state.returns()[0]))
                    self._reset_env(i)
                    continue

                player = state.current_player()
                if player < 0:
                    env.done = True
                    continue

                legal = state.legal_actions()
                if not legal:
                    env.done = True
                    continue

                # Handle pending intent actions first
                if env.pending_actions:
                    pending_envs.append((i, player, legal))
                    continue

                obs = raw_observation(state, player)

                if player == 0:
                    phase = getattr(state, "_phase", "play")
                    player0_envs.append((i, obs, legal, phase))
                else:
                    opponent_envs.append((i, obs, legal))

            # Execute pending actions (no NN call needed)
            for env_idx, player, legal in pending_envs:
                env = self.envs[env_idx]
                if env.pending_actions:
                    action = env.pending_actions.pop(0)
                    if action in legal:
                        self._apply_action(env_idx, player, action, legal)
                    else:
                        env.pending_actions.clear()

            # Batch opponent decisions first (they don't need search)
            if opponent_envs:
                self._batch_opponent_step(opponent_envs)

            # If no player 0 decisions needed and no opponents, break
            if not player0_envs and not opponent_envs and not pending_envs:
                break

            # If we have player 0 decisions, process them and return
            # (We return after one wave of player 0 decisions to allow training)
            if player0_envs:
                self._batch_player0_step(player0_envs)
                break

        return completed

    def _batch_player0_step(self, envs_data: List[Tuple]):
        """
        Batch process all player 0 decisions.

        Key insight: One forward pass for all environments!
        """
        if not envs_data:
            return

        # Separate mustering from other phases
        mustering = [(i, obs, legal, ph) for i, obs, legal, ph in envs_data if ph == "mustering"]
        standard = [(i, obs, legal, ph) for i, obs, legal, ph in envs_data if ph != "mustering"]

        # Handle mustering with intents
        for env_idx, obs, legal, _ in mustering:
            self._handle_mustering(env_idx, obs, legal)

        # Handle standard phases with batched inference
        if standard:
            indices = [d[0] for d in standard]
            observations = [d[1] for d in standard]
            legals = [d[2] for d in standard]

            # Single batched forward pass
            obs_t = torch.tensor(observations, dtype=torch.float32, device=self.device)

            with torch.inference_mode():
                logits, values = self.net(obs_t)
                logits = logits.clamp(-50, 50)

            # Process each result
            for j, (env_idx, legal) in enumerate(zip(indices, legals)):
                log_j = logits[j]
                val_j = values[j].item()

                # Apply mask
                mask = torch.full((NUM_ACTIONS,), -1e9, device=self.device)
                for a in legal:
                    mask[a] = 0.0

                if self.use_gumbel and len(legal) > 1:
                    # Gumbel action selection
                    action = self._gumbel_select(env_idx, log_j, mask, legal)
                else:
                    # Sample from policy
                    probs = F.softmax(log_j + mask, dim=0)
                    if torch.isnan(probs).any():
                        action = random.choice(legal)
                    else:
                        action = torch.multinomial(probs, 1).item()

                self._apply_action(env_idx, 0, action, legal, val_j)

    def _batch_opponent_step(self, envs_data: List[Tuple]):
        """Batch process opponent decisions."""
        if not envs_data:
            return

        indices = [d[0] for d in envs_data]
        observations = [d[1] for d in envs_data]
        legals = [d[2] for d in envs_data]

        obs_t = torch.tensor(observations, dtype=torch.float32, device=self.device)

        with torch.inference_mode():
            logits, _ = self.net(obs_t)
            logits = logits.clamp(-50, 50)

        for j, (env_idx, legal) in enumerate(zip(indices, legals)):
            mask = torch.full((NUM_ACTIONS,), -1e9, device=self.device)
            for a in legal:
                mask[a] = 0.0

            probs = F.softmax(logits[j] + mask, dim=0)
            if torch.isnan(probs).any():
                action = random.choice(legal)
            else:
                action = torch.multinomial(probs, 1).item()

            self.envs[env_idx].game_state.apply_action(action)

    def _handle_mustering(self, env_idx: int, obs: List[float], legal: List[int]):
        """Handle mustering phase with intent selection."""
        env = self.envs[env_idx]
        state = env.game_state
        player = 0

        # Get/compute intents
        cache_key = hash((tuple(sorted(state._hands[player])),
                         tuple(sorted(state._army_ids[player]))))

        if cache_key not in self._intent_cache:
            self._intent_cache[cache_key] = get_intents(state, player)
            # LRU eviction
            if len(self._intent_cache) > 500:
                keys = list(self._intent_cache.keys())[:100]
                for k in keys:
                    del self._intent_cache[k]

        intents = self._intent_cache[cache_key]

        if len(intents) <= 1:
            intent = intents[0] if intents else Intent(frozenset(), None)
        else:
            # Quick intent selection: evaluate a sample
            intent = self._select_intent(state, player, intents)

        actions = execute_intent(state, player, intent)
        if actions and actions[0] in legal:
            env.pending_actions = actions[1:]
            self._apply_action(env_idx, player, actions[0], legal)
        else:
            # Fallback
            self._apply_action(env_idx, player, legal[0], legal)

    def _select_intent(self, state, player: int, intents: List[Intent]) -> Intent:
        """Select best intent using batched evaluation."""
        # Sample if too many
        sample = intents if len(intents) <= 16 else random.sample(intents, 16)

        # Simulate each and evaluate
        observations = []
        valid_intents = []

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

            if valid and not sim.is_terminal():
                obs = raw_observation(sim, sim.current_player())
                observations.append(obs)
                valid_intents.append(intent)

        if not observations:
            return intents[0]

        # Batched evaluation
        obs_t = torch.tensor(observations, dtype=torch.float32, device=self.device)
        with torch.inference_mode():
            _, values = self.net(obs_t)

        # Add heuristic bonus
        scores = values.cpu().numpy()
        for i, intent in enumerate(valid_intents):
            bonus = sum(state._card_values.get(c, 0) for c in intent.targets) / 72.0
            scores[i] += 0.1 * bonus

        best_idx = int(np.argmax(scores))
        return valid_intents[best_idx]

    def _gumbel_select(
        self,
        env_idx: int,
        logits: torch.Tensor,
        mask: torch.Tensor,
        legal: List[int],
    ) -> int:
        """
        Gumbel action selection with batched simulation.

        Simplified: Use Gumbel to select top-k, simulate, pick best.
        """
        k = min(len(legal), max(2, self.n_sims))

        # Gumbel-Top-k
        masked = logits + mask
        gumbels = -torch.log(-torch.log(torch.rand_like(masked).clamp(1e-10, 1-1e-10)))
        perturbed = masked + gumbels

        topk_vals, topk_idx = torch.topk(perturbed, k)
        candidates = [legal[i] for i in topk_idx.tolist() if i < len(legal)]

        if len(candidates) <= 1:
            return candidates[0] if candidates else legal[0]

        # Simulate each candidate
        env = self.envs[env_idx]
        state = env.game_state

        observations = []
        valid_actions = []

        for action in candidates:
            sim = state._clone_impl()
            sim.apply_action(action)

            if sim.is_terminal():
                # Use terminal value directly
                ret = sim.returns()[0]
                # We'll handle this separately
                valid_actions.append((action, ret, True))
            else:
                obs = raw_observation(sim, sim.current_player())
                observations.append(obs)
                valid_actions.append((action, obs, False))

        if not observations:
            # All terminal, pick best
            best = max(valid_actions, key=lambda x: x[1])
            return best[0]

        # Batched evaluation of non-terminal states
        obs_t = torch.tensor(
            [va[1] for va in valid_actions if not va[2]],
            dtype=torch.float32,
            device=self.device
        )

        with torch.inference_mode():
            _, values = self.net(obs_t)
            values = values.cpu().numpy()

        # Combine values
        val_idx = 0
        action_values = []
        for action, data, is_terminal in valid_actions:
            if is_terminal:
                action_values.append((action, data))  # data is return
            else:
                action_values.append((action, values[val_idx]))
                val_idx += 1

        best = max(action_values, key=lambda x: x[1])
        return best[0]

    def _apply_action(self, env_idx: int, player: int, action: int, legal: List[int], value: float = 0.0):
        """Apply action and record if player 0."""
        env = self.envs[env_idx]

        if player == 0:
            obs = raw_observation(env.game_state, player)
            env.trajectory.append((obs, action, legal, value))

        env.game_state.apply_action(action)


# ---------------------------------------------------------------------------
# Replay Buffer
# ---------------------------------------------------------------------------

class ReplayBuffer:
    def __init__(self, max_size: int = 100_000):
        self.buffer = deque(maxlen=max_size)

    def add_trajectory(self, trajectory: List[Tuple], final_return: float, gamma: float, gae_lambda: float):
        if not trajectory:
            return

        values = [t[3] for t in trajectory]
        advantages, returns = compute_gae(final_return, values, gamma, gae_lambda)

        for i, (obs, action, legal, _) in enumerate(trajectory):
            adv = advantages[i] if i < len(advantages) else 0.0
            ret = returns[i] if i < len(returns) else final_return
            if not (math.isnan(adv) or math.isnan(ret)):
                self.buffer.append((obs, action, legal, adv, ret))

    def sample(self, batch_size: int):
        indices = random.sample(range(len(self.buffer)), min(batch_size, len(self.buffer)))
        batch = [self.buffer[i] for i in indices]
        return (
            [b[0] for b in batch],
            [b[1] for b in batch],
            [b[2] for b in batch],
            [b[3] for b in batch],
            [b[4] for b in batch],
        )

    def __len__(self):
        return len(self.buffer)

    def clear(self):
        self.buffer.clear()


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train_step(
    net: BlazingNet,
    optimizer: torch.optim.Optimizer,
    obs, actions, legals, advantages, returns,
    device: torch.device,
    entropy_coeff: float = 0.01,
    value_coeff: float = 0.5,
) -> Dict[str, float]:
    n = len(obs)
    if n == 0:
        return {"policy_loss": 0.0, "value_loss": 0.0, "entropy": 0.0}

    obs_t = torch.tensor(obs, dtype=torch.float32, device=device)
    acts_t = torch.tensor(actions, dtype=torch.long, device=device)
    adv_t = torch.tensor(advantages, dtype=torch.float32, device=device).clamp(-10, 10)
    ret_t = torch.tensor(returns, dtype=torch.float32, device=device).clamp(-10, 10)

    # Normalize
    if adv_t.std() > 1e-8:
        adv_t = (adv_t - adv_t.mean()) / (adv_t.std() + 1e-8)

    # Masks
    masks = torch.full((n, NUM_ACTIONS), -1e9, device=device)
    for i, legal in enumerate(legals):
        for a in legal:
            masks[i, a] = 0.0

    # Forward
    logits, values = net(obs_t)
    logits = logits.clamp(-50, 50) + masks

    # Losses
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


def main():
    parser = argparse.ArgumentParser(description="Blazing MK-II: GPU-Parallelized Training")

    parser.add_argument("--max_time", type=int, default=0)
    parser.add_argument("--max_episodes", type=int, default=1_000_000)

    # Vectorized environments
    parser.add_argument("--n_envs", type=int, default=64,
                        help="Number of parallel environments")

    # Network
    parser.add_argument("--hidden_size", type=int, default=512)
    parser.add_argument("--num_layers", type=int, default=4)

    # Gumbel search
    parser.add_argument("--n_simulations", type=int, default=4)
    parser.add_argument("--no_search", action="store_true")

    # Training
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--train_batch_size", type=int, default=2048)
    parser.add_argument("--entropy_coeff", type=float, default=0.01)
    parser.add_argument("--gamma", type=float, default=0.99)
    parser.add_argument("--gae_lambda", type=float, default=0.95)

    # Eval
    parser.add_argument("--eval_every", type=int, default=500)
    parser.add_argument("--eval_games", type=int, default=200)

    # Output
    parser.add_argument("--output", type=str, default=None)
    parser.add_argument("--output_prefix", type=str, default="policy_blazing2")
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

    print()
    print("=" * 60)
    print("  Blazing MK-II — GPU-Parallelized Training")
    print("=" * 60)
    print()
    print(f"  Device:        {device}")
    print(f"  Parallel envs: {args.n_envs}")
    print(f"  Network:       {n_params:,} params")
    print(f"  Gumbel:        {'OFF' if args.no_search else f'{args.n_simulations} sims'}")
    print()
    if args.max_time > 0:
        print(f"  Max time:      {args.max_time}s")
    print()
    print("=" * 60)
    print()

    # Vectorized environment
    vec_env = VectorizedGames(
        n_envs=args.n_envs,
        net=net,
        device=device,
        use_gumbel=not args.no_search,
        n_simulations=args.n_simulations,
    )

    replay = ReplayBuffer(max_size=100_000)
    game = pyspiel.load_game("imposter_zero_match")

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

            # Step all environments
            completed = vec_env.step_all()

            # Process completed games
            for trajectory, final_return in completed:
                replay.add_trajectory(trajectory, final_return, args.gamma, args.gae_lambda)
                episode += 1

            # Train
            if len(replay) >= args.train_batch_size:
                obs, acts, legals, advs, rets = replay.sample(args.train_batch_size)
                metrics = train_step(net, optimizer, obs, acts, legals, advs, rets,
                                    device, args.entropy_coeff)

            # Report
            now = time.time()
            if now - last_report >= 30:
                eps_per_sec = episode / (now - start) if now > start else 0
                print(
                    f"[{(now-start)/60:.1f}m] {episode:,} eps ({eps_per_sec:.1f}/s) "
                    f"| buf={len(replay):,} "
                    f"| p={metrics.get('policy_loss', 0):.4f} "
                    f"| e={metrics.get('entropy', 0):.3f}"
                )
                last_report = now

            # Eval
            if episode > 0 and episode % args.eval_every == 0:
                wr = evaluate_vs_random(game, net, device, args.eval_games)
                wr_f = evaluate_vs_frozen(game, net, frozen, device, args.eval_games // 2)
                print(f"[Eval {episode:,}] vs-random={wr:.1%} vs-frozen={wr_f:.1%} | best={best_wr:.1%}")

                if wr > best_wr:
                    best_wr = wr
                    net.cpu()
                    export_weights(net, args.output, {
                        "algorithm": "blazing_mk_ii",
                        "action_space": "raw",
                        "num_actions": NUM_ACTIONS,
                        "input_size": OBS_SIZE,
                        "hidden_size": args.hidden_size,
                        "num_layers": args.num_layers - 1,  # Actual hidden layers in encoder
                        "output_size": NUM_ACTIONS,
                        "n_envs": args.n_envs,
                        "n_simulations": args.n_simulations,
                        "episodes": episode,
                        "win_rate_vs_random": round(wr, 4),
                    }, exclude_prefixes=["value_head"])
                    net.to(device)

                if wr_f >= 0.55:
                    frozen.load_state_dict(net.state_dict())

            # Cleanup
            if episode % 1000 == 0:
                gc.collect()
                if torch.backends.mps.is_available():
                    torch.mps.empty_cache()

    except KeyboardInterrupt:
        print("\nInterrupted")

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
            "algorithm": "blazing_mk_ii",
            "action_space": "raw",
            "num_actions": NUM_ACTIONS,
            "input_size": OBS_SIZE,
            "hidden_size": args.hidden_size,
            "num_layers": args.num_layers - 1,  # Actual hidden layers in encoder
            "output_size": NUM_ACTIONS,
            "episodes": episode,
            "win_rate_vs_random": round(wr, 4),
        }, exclude_prefixes=["value_head"])
    print(f"  -> {args.output}")


if __name__ == "__main__":
    main()
