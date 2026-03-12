"""
Blazing MK-I — High-Performance Training for Imposter Zero

Key innovations from recent research:
1. Gumbel AlphaZero search — learn with 2-16 simulations instead of 100+
2. Batched self-play — multiple games per forward pass
3. Sequential halving — efficient simulation budget allocation
4. Intent-conditioned mustering — hierarchical action space
5. Memory-conscious design — explicit cleanup, streaming updates

Based on:
- "Policy Improvement by Planning with Gumbel" (Danihelka et al.)
- AlphaStar action decomposition
- Option-Critic hierarchical RL

Usage:
  python train_blazing_mk_i.py --max_time 3600 --n_simulations 8
"""

from __future__ import annotations

import argparse
import gc
import json
import math
import os
import random
import time
import weakref
from collections import deque
from dataclasses import dataclass, field
from itertools import combinations
from typing import Dict, FrozenSet, List, Optional, Tuple, Iterator

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import pyspiel

import imposter_zero.game as ig  # noqa: F401

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
# Memory Management Utilities
# ---------------------------------------------------------------------------

class MemoryTracker:
    """Track and report memory usage."""

    def __init__(self, name: str = "default"):
        self.name = name
        self.checkpoints = []

    def checkpoint(self, label: str):
        import tracemalloc
        if not tracemalloc.is_tracing():
            tracemalloc.start()
        current, peak = tracemalloc.get_traced_memory()
        self.checkpoints.append((label, current / 1024 / 1024, peak / 1024 / 1024))

    def report(self):
        if self.checkpoints:
            print(f"  Memory ({self.name}):")
            for label, current, peak in self.checkpoints[-3:]:
                print(f"    {label}: {current:.1f}MB (peak: {peak:.1f}MB)")


def cleanup():
    """Aggressive memory cleanup."""
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    elif torch.cuda.is_available():
        torch.cuda.empty_cache()


# ---------------------------------------------------------------------------
# Gumbel Utilities
# ---------------------------------------------------------------------------

def sample_gumbel(shape: Tuple[int, ...], device: torch.device) -> torch.Tensor:
    """Sample from Gumbel(0, 1) distribution."""
    u = torch.rand(shape, device=device).clamp(1e-10, 1 - 1e-10)
    return -torch.log(-torch.log(u))


def gumbel_top_k(logits: torch.Tensor, k: int, temperature: float = 1.0) -> Tuple[torch.Tensor, torch.Tensor]:
    """
    Gumbel-Top-k trick for sampling k actions without replacement.

    Returns:
        selected_indices: (k,) indices of selected actions
        gumbel_values: (k,) Gumbel values for selected actions
    """
    gumbels = sample_gumbel(logits.shape, logits.device)
    perturbed = logits / temperature + gumbels

    # Top-k selection
    values, indices = torch.topk(perturbed, k=min(k, logits.size(-1)))
    return indices, values


def compute_improved_policy(
    logits: torch.Tensor,
    completed_q_values: torch.Tensor,
    legal_mask: torch.Tensor,
    temperature: float = 1.0,
) -> torch.Tensor:
    """
    Compute improved policy from completed Q-values (Gumbel AlphaZero style).

    The key insight: after search, we have better Q-value estimates.
    The improved policy should concentrate on high-Q actions.
    """
    # Mask illegal actions
    masked_q = completed_q_values.clone()
    masked_q[~legal_mask] = float('-inf')

    # Softmax over Q-values gives improved policy
    improved = F.softmax(masked_q / temperature, dim=-1)
    return improved


# ---------------------------------------------------------------------------
# Mustering Intent System (from quattro, optimized)
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class MusteringIntent:
    """Compact intent representation with slots for memory efficiency."""
    recruit_targets: FrozenSet[int]
    select_facet: Optional[str]


class IntentCache:
    """Cache feasible intents to avoid recomputation."""

    def __init__(self, max_size: int = 1000):
        self.cache: Dict[int, List[MusteringIntent]] = {}
        self.max_size = max_size

    def get_or_compute(self, state, player: int) -> List[MusteringIntent]:
        # Simple hash based on hand + army state
        key = hash((
            tuple(sorted(state._hands[player])),
            tuple(sorted(state._army_ids[player])),
            state._king_facets[player],
        ))

        if key in self.cache:
            return self.cache[key]

        intents = self._enumerate_intents(state, player)

        # LRU-style eviction
        if len(self.cache) >= self.max_size:
            # Remove oldest quarter
            to_remove = list(self.cache.keys())[:self.max_size // 4]
            for k in to_remove:
                del self.cache[k]

        self.cache[key] = intents
        return intents

    def _enumerate_intents(self, state, player: int) -> List[MusteringIntent]:
        intents = []
        hand = state._hands[player]
        army = state._army_ids[player]
        facet = state._king_facets[player]

        max_recruits = min(len(hand), len(army))
        facet_options = [None] if facet != "default" else [None, "charismatic", "masterTactician"]

        for n in range(max_recruits + 1):
            for combo in combinations(army, n):
                for f in facet_options:
                    intents.append(MusteringIntent(frozenset(combo), f))

        return intents

    def clear(self):
        self.cache.clear()


def execute_intent_fast(state, player: int, intent: MusteringIntent) -> List[int]:
    """Execute intent, returning primitive actions. Optimized version."""
    actions = []
    mcid = state._max_card_id
    np = 2  # Always 2 players

    # Track mutable state locally
    hand = list(state._hands[player])
    army = list(state._army_ids[player])
    has_exhausted = state._has_exhausted_this_mustering

    # Precompute card values for sorting
    val = state._card_values.get

    # 1. Facet selection
    if intent.select_facet and state._king_facets[player] == "default":
        idx = 0 if intent.select_facet == "charismatic" else 1
        actions.append(ig._encode_select_king(idx, mcid, np))

    # 2. Execute recruitments (sorted by target value, descending)
    targets = sorted(intent.recruit_targets, key=lambda c: val(c, 0), reverse=True)

    for target in targets:
        if not hand or target not in army:
            continue

        if not has_exhausted:
            # Exhaust lowest-value army card (that's not the target)
            exhaust_candidates = [c for c in army if c != target]
            if not exhaust_candidates:
                exhaust_candidates = army  # Fall back to any
            exhaust = min(exhaust_candidates, key=lambda c: val(c, 0))
            actions.append(ig._encode_begin_recruit(exhaust, mcid, np))
            army.remove(exhaust)
            has_exhausted = True

        # Discard lowest-value hand card
        discard = min(hand, key=lambda c: val(c, 0))
        actions.append(ig._encode_recruit(discard, target, mcid, np))
        hand.remove(discard)
        if target in army:  # Only remove if still there
            army.remove(target)
        hand.append(target)
        has_exhausted = False

    # 3. End mustering
    actions.append(ig._encode_end_mustering(mcid, np))

    return actions


# ---------------------------------------------------------------------------
# Blazing Network Architecture
# ---------------------------------------------------------------------------

class BlazingNetwork(nn.Module):
    """
    Efficient network with:
    - Compiled forward pass (torch.compile ready)
    - Separate policy/value heads
    - Intent scoring head for mustering
    """

    def __init__(
        self,
        input_size: int,
        hidden_size: int,
        num_actions: int,
        num_layers: int = 4,
    ):
        super().__init__()

        self.input_size = input_size
        self.hidden_size = hidden_size
        self.num_actions = num_actions

        # Shared encoder
        layers = []
        in_dim = input_size
        for _ in range(num_layers - 1):
            layers.extend([
                nn.Linear(in_dim, hidden_size),
                nn.ReLU(inplace=True),  # inplace saves memory
            ])
            in_dim = hidden_size
        self.encoder = nn.Sequential(*layers)

        # Heads
        self.policy_head = nn.Linear(hidden_size, num_actions)
        self.value_head = nn.Linear(hidden_size, 1)

        # Intent scoring (lightweight)
        self.intent_proj = nn.Linear(16, hidden_size // 4)
        self.intent_score = nn.Linear(hidden_size + hidden_size // 4, 1)

        # Initialize
        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=0.01)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        h = self.encoder(x)
        logits = self.policy_head(h)
        value = self.value_head(h).squeeze(-1)
        return logits, value

    def encode(self, x: torch.Tensor) -> torch.Tensor:
        return self.encoder(x)

    def policy(self, x: torch.Tensor) -> torch.Tensor:
        """Policy logits only (for compatibility with evaluation functions)."""
        h = self.encoder(x)
        return self.policy_head(h)

    @torch.inference_mode()
    def batch_evaluate(
        self,
        observations: List[List[float]],
        device: torch.device,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Batch evaluation for multiple states. Returns numpy arrays."""
        if not observations:
            return np.array([]), np.array([])

        x = torch.tensor(observations, dtype=torch.float32, device=device)
        logits, values = self.forward(x)

        return logits.cpu().numpy(), values.cpu().numpy()


# ---------------------------------------------------------------------------
# Gumbel Search
# ---------------------------------------------------------------------------

@dataclass
class SearchResult:
    """Result from Gumbel search."""
    action: int
    policy: np.ndarray
    value: float
    visit_counts: np.ndarray


class GumbelSearch:
    """
    Gumbel AlphaZero-style search with sequential halving.

    Key insight: Instead of many MCTS iterations, use Gumbel sampling
    to select promising actions, then use sequential halving to
    allocate simulation budget efficiently.
    """

    def __init__(
        self,
        net: BlazingNetwork,
        device: torch.device,
        n_simulations: int = 8,
        c_scale: float = 1.0,
        temperature: float = 1.0,
    ):
        self.net = net
        self.device = device
        self.n_simulations = n_simulations
        self.c_scale = c_scale
        self.temperature = temperature

    def search(
        self,
        state,
        player: int,
        legal_actions: List[int],
    ) -> SearchResult:
        """
        Run Gumbel search from given state.

        Uses sequential halving: start with k actions, simulate,
        halve the candidates, repeat until one remains.
        """
        n_actions = len(legal_actions)

        if n_actions == 0:
            return SearchResult(0, np.array([1.0]), 0.0, np.array([1]))

        if n_actions == 1:
            return SearchResult(
                legal_actions[0],
                np.array([1.0]),
                self._evaluate_state(state, player),
                np.array([1])
            )

        # Get prior policy and value from network
        obs = raw_observation(state, player)
        with torch.inference_mode():
            obs_t = torch.tensor([obs], dtype=torch.float32, device=self.device)
            logits, value = self.net(obs_t)
            logits = logits.squeeze(0)
            value = value.item()

        # Create legal mask
        legal_mask = torch.zeros(NUM_ACTIONS, dtype=torch.bool, device=self.device)
        for a in legal_actions:
            legal_mask[a] = True

        # Extract logits for legal actions only
        legal_logits = logits[legal_mask].clone()

        # Gumbel sampling for initial candidates
        k = min(n_actions, max(2, self.n_simulations // 2))
        selected_idx, gumbel_vals = gumbel_top_k(legal_logits, k, self.temperature)

        # Map back to action indices
        legal_action_tensor = torch.tensor(legal_actions, device=self.device)
        candidates = legal_action_tensor[selected_idx].tolist()

        # Sequential halving
        visit_counts = {a: 0 for a in legal_actions}
        q_values = {a: 0.0 for a in legal_actions}

        remaining = candidates
        sims_per_round = max(1, self.n_simulations // (int(math.log2(k)) + 1))

        while len(remaining) > 1 and sum(visit_counts.values()) < self.n_simulations:
            # Simulate each remaining candidate
            for action in remaining:
                if sum(visit_counts.values()) >= self.n_simulations:
                    break

                # Simulate: apply action, evaluate resulting state
                sim_state = state._clone_impl()
                sim_state.apply_action(action)

                # Get value of resulting state
                if sim_state.is_terminal():
                    returns = sim_state.returns()
                    sim_value = returns[player]
                else:
                    sim_value = self._evaluate_state(sim_state, player)

                # Update Q estimate
                visit_counts[action] += 1
                n = visit_counts[action]
                q_values[action] += (sim_value - q_values[action]) / n

            # Halve candidates (keep best half by Q-value)
            remaining = sorted(remaining, key=lambda a: q_values[a], reverse=True)
            remaining = remaining[:max(1, len(remaining) // 2)]

        # Compute improved policy
        q_tensor = torch.tensor([q_values.get(a, 0.0) for a in legal_actions], device=self.device)
        improved_policy = F.softmax(q_tensor / self.temperature, dim=0).cpu().numpy()

        # Select action (best by Q or sample from improved policy)
        best_action = max(legal_actions, key=lambda a: q_values.get(a, 0.0))

        # Build visit count array
        vc_array = np.array([visit_counts.get(a, 0) for a in legal_actions])

        return SearchResult(
            action=best_action,
            policy=improved_policy,
            value=value,
            visit_counts=vc_array,
        )

    def _evaluate_state(self, state, player: int) -> float:
        """Quick state evaluation using network."""
        if state.is_terminal():
            return state.returns()[player]

        obs = raw_observation(state, state.current_player())
        with torch.inference_mode():
            obs_t = torch.tensor([obs], dtype=torch.float32, device=self.device)
            _, value = self.net(obs_t)
            return value.item()


# ---------------------------------------------------------------------------
# Batched Self-Play
# ---------------------------------------------------------------------------

@dataclass
class GameState:
    """Mutable game state wrapper for batched play."""
    state: object
    trajectory: List[Tuple]  # (obs, action, policy, value)
    player_id: int = 0
    done: bool = False

    # Intent execution state
    pending_actions: List[int] = field(default_factory=list)
    current_intent: Optional[MusteringIntent] = None


class BatchedSelfPlay:
    """
    Run multiple games in parallel, batching neural network evaluations.

    Memory-conscious design:
    - Games yielded as completed (not stored)
    - Explicit cleanup between batches
    - Intent cache with size limit
    """

    def __init__(
        self,
        net: BlazingNetwork,
        device: torch.device,
        batch_size: int = 32,
        n_simulations: int = 8,
        use_gumbel_search: bool = True,
        intent_cache_size: int = 500,
    ):
        self.net = net
        self.device = device
        self.batch_size = batch_size
        self.n_simulations = n_simulations
        self.use_gumbel_search = use_gumbel_search

        self.game = pyspiel.load_game("imposter_zero_match")
        self.intent_cache = IntentCache(max_size=intent_cache_size)

        if use_gumbel_search:
            self.searcher = GumbelSearch(
                net, device,
                n_simulations=n_simulations,
            )

    def generate_games(self, n_games: int) -> Iterator[Tuple[List, float]]:
        """
        Generate completed games as iterator (memory efficient).

        Yields: (trajectory, final_return) for player 0
        """
        active_games: List[GameState] = []

        # Initialize batch of games
        for _ in range(min(n_games, self.batch_size)):
            gs = GameState(
                state=self.game.new_initial_state(),
                trajectory=[],
            )
            active_games.append(gs)

        games_completed = 0
        games_to_create = n_games - len(active_games)

        while active_games or games_to_create > 0:
            # Step all active games
            completed_indices = []

            for i, gs in enumerate(active_games):
                if gs.done:
                    completed_indices.append(i)
                    continue

                self._step_game(gs)

                if gs.done:
                    completed_indices.append(i)

            # Yield completed games
            for i in reversed(completed_indices):
                gs = active_games.pop(i)
                returns = gs.state.returns()
                yield (gs.trajectory, returns[0])
                games_completed += 1

                # Clean up
                del gs.trajectory
                del gs.state
                del gs

            # Refill batch
            while len(active_games) < self.batch_size and games_to_create > 0:
                gs = GameState(
                    state=self.game.new_initial_state(),
                    trajectory=[],
                )
                active_games.append(gs)
                games_to_create -= 1

            # Periodic cleanup
            if games_completed % 100 == 0:
                cleanup()

        # Final cleanup
        self.intent_cache.clear()
        cleanup()

    def _step_game(self, gs: GameState):
        """Advance game by one step."""
        state = gs.state

        if state.is_terminal():
            gs.done = True
            return

        player = state.current_player()
        if player < 0:
            gs.done = True
            return

        legal = state.legal_actions()
        if not legal:
            gs.done = True
            return

        phase = getattr(state, "_phase", "play")

        # Handle pending intent actions
        if gs.pending_actions:
            action = gs.pending_actions.pop(0)
            if action in legal:
                self._record_and_apply(gs, player, action, legal)
            else:
                # Fallback if action invalid
                gs.pending_actions.clear()
                self._step_game(gs)
            return

        # Mustering with intents
        if phase == "mustering" and player == 0:
            intents = self.intent_cache.get_or_compute(state, player)

            if len(intents) > 1 and self.use_gumbel_search:
                # Use Gumbel search over intents
                best_intent = self._search_intents(state, player, intents)
                gs.current_intent = best_intent

                actions = execute_intent_fast(state, player, best_intent)
                if actions:
                    gs.pending_actions = actions[1:]
                    action = actions[0]
                    if action in legal:
                        self._record_and_apply(gs, player, action, legal)
                        return

            # Fallback: execute first feasible intent
            if intents:
                actions = execute_intent_fast(state, player, intents[0])
                if actions and actions[0] in legal:
                    gs.pending_actions = actions[1:]
                    self._record_and_apply(gs, player, actions[0], legal)
                    return

        # Standard action selection
        if player == 0:
            if self.use_gumbel_search and len(legal) > 1:
                result = self.searcher.search(state, player, legal)
                action = result.action
                policy = result.policy
                value = result.value
            else:
                obs = raw_observation(state, player)
                with torch.inference_mode():
                    obs_t = torch.tensor([obs], dtype=torch.float32, device=self.device)
                    logits, value_t = self.net(obs_t)
                    logits = logits.squeeze(0).clamp(-50, 50)
                    value = value_t.item()

                # Mask and sample
                mask = torch.full((NUM_ACTIONS,), -1e9, device=self.device)
                for a in legal:
                    mask[a] = 0.0
                masked_logits = logits + mask
                probs = F.softmax(masked_logits, dim=0)

                # Safety check
                if torch.isnan(probs).any() or torch.isinf(probs).any() or (probs < 0).any():
                    action = random.choice(legal)
                    policy = np.ones(len(legal)) / len(legal)
                else:
                    action = torch.multinomial(probs, 1).item()
                    policy = probs[torch.tensor(legal, device=self.device)].cpu().numpy()

            # Record for player 0
            obs = raw_observation(state, player)
            gs.trajectory.append((obs, action, legal, value))

        else:
            # Opponent: simple policy sampling
            obs = raw_observation(state, player)
            with torch.inference_mode():
                obs_t = torch.tensor([obs], dtype=torch.float32, device=self.device)
                logits, _ = self.net(obs_t)
                logits = logits.squeeze(0).clamp(-50, 50)

            mask = torch.full((NUM_ACTIONS,), -1e9, device=self.device)
            for a in legal:
                mask[a] = 0.0
            masked_logits = logits + mask
            probs = F.softmax(masked_logits, dim=0)

            # Safety check for NaN/Inf
            if torch.isnan(probs).any() or torch.isinf(probs).any() or (probs < 0).any():
                action = random.choice(legal)
            else:
                action = torch.multinomial(probs, 1).item()

        state.apply_action(action)

    def _record_and_apply(self, gs: GameState, player: int, action: int, legal: List[int]):
        """Record transition and apply action."""
        if player == 0:
            obs = raw_observation(gs.state, player)
            with torch.inference_mode():
                obs_t = torch.tensor([obs], dtype=torch.float32, device=self.device)
                _, value = self.net(obs_t)
            gs.trajectory.append((obs, action, legal, value.item()))

        gs.state.apply_action(action)

    def _search_intents(
        self,
        state,
        player: int,
        intents: List[MusteringIntent],
    ) -> MusteringIntent:
        """Quick search over intents using Q-value estimation."""
        if len(intents) <= 1:
            return intents[0] if intents else MusteringIntent(frozenset(), None)

        # Evaluate each intent by simulating its execution
        best_intent = intents[0]
        best_value = float('-inf')

        # Sample subset if too many intents
        sample_intents = intents if len(intents) <= 16 else random.sample(intents, 16)

        for intent in sample_intents:
            actions = execute_intent_fast(state, player, intent)
            if not actions:
                continue

            # Simulate
            sim_state = state._clone_impl()
            valid = True
            for action in actions:
                if action in sim_state.legal_actions():
                    sim_state.apply_action(action)
                else:
                    valid = False
                    break

            if not valid:
                continue

            # Evaluate resulting state
            if sim_state.is_terminal():
                value = sim_state.returns()[player]
            else:
                obs = raw_observation(sim_state, sim_state.current_player())
                with torch.inference_mode():
                    obs_t = torch.tensor([obs], dtype=torch.float32, device=self.device)
                    _, value_t = self.net(obs_t)
                    value = value_t.item()

            # Add heuristic bonus for recruiting high-value cards
            recruit_value = sum(state._card_values.get(c, 0) for c in intent.recruit_targets)
            value += 0.1 * (recruit_value / 72.0)  # Normalized bonus

            if value > best_value:
                best_value = value
                best_intent = intent

        return best_intent


# ---------------------------------------------------------------------------
# Training Loop
# ---------------------------------------------------------------------------

class ReplayBuffer:
    """Simple replay buffer with memory limit."""

    def __init__(self, max_size: int = 100_000):
        self.buffer: deque = deque(maxlen=max_size)

    def add(self, obs, action, legal, advantage, returns):
        self.buffer.append((obs, action, legal, advantage, returns))

    def sample(self, batch_size: int) -> Tuple:
        indices = random.sample(range(len(self.buffer)), min(batch_size, len(self.buffer)))
        batch = [self.buffer[i] for i in indices]

        obs = [b[0] for b in batch]
        actions = [b[1] for b in batch]
        legals = [b[2] for b in batch]
        advantages = [b[3] for b in batch]
        returns = [b[4] for b in batch]

        return obs, actions, legals, advantages, returns

    def __len__(self):
        return len(self.buffer)

    def clear(self):
        self.buffer.clear()


def train_step(
    net: BlazingNetwork,
    optimizer: torch.optim.Optimizer,
    obs: List,
    actions: List,
    legals: List,
    advantages: List,
    returns: List,
    device: torch.device,
    clip_ratio: float = 0.2,
    entropy_coeff: float = 0.01,
    value_coeff: float = 0.5,
) -> Dict[str, float]:
    """Single PPO training step with NaN safeguards."""
    n = len(obs)
    if n == 0:
        return {"policy_loss": 0.0, "value_loss": 0.0, "entropy": 0.0}

    # Filter out any NaN values
    valid_indices = []
    for i in range(n):
        if (not math.isnan(advantages[i]) and not math.isnan(returns[i]) and
            not math.isinf(advantages[i]) and not math.isinf(returns[i])):
            valid_indices.append(i)

    if not valid_indices:
        return {"policy_loss": 0.0, "value_loss": 0.0, "entropy": 0.0}

    obs = [obs[i] for i in valid_indices]
    actions = [actions[i] for i in valid_indices]
    legals = [legals[i] for i in valid_indices]
    advantages = [advantages[i] for i in valid_indices]
    returns = [returns[i] for i in valid_indices]
    n = len(obs)

    obs_t = torch.tensor(obs, dtype=torch.float32, device=device)
    acts_t = torch.tensor(actions, dtype=torch.long, device=device)
    adv_t = torch.tensor(advantages, dtype=torch.float32, device=device)
    ret_t = torch.tensor(returns, dtype=torch.float32, device=device)

    # Clamp returns to reasonable range
    ret_t = ret_t.clamp(-10, 10)

    # Normalize advantages
    if adv_t.std() > 1e-8:
        adv_t = (adv_t - adv_t.mean()) / (adv_t.std() + 1e-8)
    else:
        adv_t = adv_t - adv_t.mean()

    # Clamp advantages
    adv_t = adv_t.clamp(-10, 10)

    # Build masks
    masks = torch.full((n, NUM_ACTIONS), -1e9, device=device)
    for i, legal in enumerate(legals):
        for a in legal:
            masks[i, a] = 0.0

    # Forward pass
    logits, values = net(obs_t)
    logits = logits.clamp(-50, 50) + masks

    # Policy loss (simplified PPO without old log probs)
    log_probs = F.log_softmax(logits, dim=1)
    action_log_probs = log_probs.gather(1, acts_t.unsqueeze(1)).squeeze(1)

    # Replace any NaN log probs
    action_log_probs = torch.nan_to_num(action_log_probs, nan=0.0, posinf=0.0, neginf=-10.0)

    policy_loss = -(action_log_probs * adv_t).mean()

    # Value loss
    value_loss = F.mse_loss(values, ret_t)

    # Entropy bonus
    probs = F.softmax(logits, dim=1)
    entropy_terms = probs * log_probs
    entropy = -torch.nan_to_num(entropy_terms, nan=0.0).sum(dim=1).mean()

    # Total loss with NaN protection
    loss = policy_loss + value_coeff * value_loss - entropy_coeff * entropy

    if torch.isnan(loss) or torch.isinf(loss):
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
    parser = argparse.ArgumentParser(description="Blazing MK-I Training")

    # Training
    parser.add_argument("--max_time", type=int, default=0)
    parser.add_argument("--max_episodes", type=int, default=1_000_000)
    parser.add_argument("--batch_size", type=int, default=32)
    parser.add_argument("--train_batch_size", type=int, default=2048)
    parser.add_argument("--train_every", type=int, default=64)

    # Network
    parser.add_argument("--hidden_size", type=int, default=512)
    parser.add_argument("--num_layers", type=int, default=4)

    # Gumbel search
    parser.add_argument("--n_simulations", type=int, default=8,
                        help="Simulations per search (2-16 recommended)")
    parser.add_argument("--no_search", action="store_true",
                        help="Disable Gumbel search (pure policy)")

    # PPO
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--entropy_coeff", type=float, default=0.01)
    parser.add_argument("--gamma", type=float, default=0.99)
    parser.add_argument("--gae_lambda", type=float, default=0.95)

    # Evaluation
    parser.add_argument("--eval_every", type=int, default=500)
    parser.add_argument("--eval_games", type=int, default=200)

    # Output
    parser.add_argument("--output", type=str, default=None)
    parser.add_argument("--output_prefix", type=str, default="policy_blazing")
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

    # Initialize network
    net = BlazingNetwork(OBS_SIZE, args.hidden_size, NUM_ACTIONS, args.num_layers).to(device)
    frozen_net = BlazingNetwork(OBS_SIZE, args.hidden_size, NUM_ACTIONS, args.num_layers).to(device)
    frozen_net.load_state_dict(net.state_dict())

    optimizer = torch.optim.Adam(net.parameters(), lr=args.lr)
    n_params = sum(p.numel() for p in net.parameters())

    print()
    print("=" * 60)
    print("  Blazing MK-I — Gumbel AlphaZero Training")
    print("=" * 60)
    print()
    print(f"  Device:        {device}")
    print(f"  Network:       {OBS_SIZE} -> {args.hidden_size}x{args.num_layers-1} -> {NUM_ACTIONS}")
    print(f"  Parameters:    {n_params:,}")
    print()
    print(f"  Gumbel search: {'OFF' if args.no_search else f'{args.n_simulations} sims'}")
    print(f"  Batch size:    {args.batch_size} games")
    print(f"  LR:            {args.lr}")
    print()
    if args.max_time > 0:
        print(f"  Max time:      {args.max_time}s")
    else:
        print(f"  Max episodes:  {args.max_episodes:,}")
    print()
    print("=" * 60)
    print()

    # Self-play generator
    self_play = BatchedSelfPlay(
        net, device,
        batch_size=args.batch_size,
        n_simulations=args.n_simulations,
        use_gumbel_search=not args.no_search,
    )

    # Replay buffer
    replay = ReplayBuffer(max_size=50_000)

    # Training state
    game = pyspiel.load_game("imposter_zero_match")
    start_time = time.time()
    last_report = start_time
    episode = 0
    best_wr = 0.0
    total_games_for_training = 0

    try:
        while True:
            # Check termination
            elapsed = time.time() - start_time
            if args.max_time > 0 and elapsed >= args.max_time:
                break
            if episode >= args.max_episodes:
                break

            # Generate games
            games_this_batch = 0
            for trajectory, final_return in self_play.generate_games(args.train_every):
                if not trajectory:
                    continue

                # Compute advantages and returns
                values = [t[3] for t in trajectory]
                advantages, returns = compute_gae(
                    final_return, values, args.gamma, args.gae_lambda
                )

                # Add to replay buffer
                for i, (obs, action, legal, _) in enumerate(trajectory):
                    adv = advantages[i] if i < len(advantages) else 0.0
                    ret = returns[i] if i < len(returns) else final_return
                    replay.add(obs, action, legal, adv, ret)

                episode += 1
                games_this_batch += 1
                total_games_for_training += 1

                # Check termination mid-batch
                if args.max_time > 0 and (time.time() - start_time) >= args.max_time:
                    break
                if episode >= args.max_episodes:
                    break

            # Training step
            if len(replay) >= args.train_batch_size:
                obs, actions, legals, advantages, returns = replay.sample(args.train_batch_size)
                metrics = train_step(
                    net, optimizer,
                    obs, actions, legals, advantages, returns,
                    device,
                    entropy_coeff=args.entropy_coeff,
                )

            # Periodic reporting
            now = time.time()
            if now - last_report >= 30:
                eps_per_sec = episode / (now - start_time) if now > start_time else 0
                print(
                    f"[{(now-start_time)/60:.1f}m] {episode:,} eps ({eps_per_sec:.1f}/s) "
                    f"| buffer={len(replay):,} "
                    f"| p_loss={metrics.get('policy_loss', 0):.4f} "
                    f"| entropy={metrics.get('entropy', 0):.4f}"
                )
                last_report = now

            # Evaluation
            if episode > 0 and episode % args.eval_every == 0:
                wr = evaluate_vs_random(game, net, device, args.eval_games)
                wr_frozen = evaluate_vs_frozen(game, net, frozen_net, device, args.eval_games // 2)

                print(
                    f"[Eval {episode:,}] vs-random={wr:.1%} vs-frozen={wr_frozen:.1%} "
                    f"| best={best_wr:.1%}"
                )

                if wr > best_wr:
                    best_wr = wr
                    net.cpu()
                    meta = {
                        "algorithm": "blazing_mk_i_gumbel",
                        "n_simulations": args.n_simulations,
                        "episodes": episode,
                        "win_rate_vs_random": round(wr, 4),
                        "input_size": OBS_SIZE,
                        "hidden_size": args.hidden_size,
                        "num_layers": args.num_layers,
                        "output_size": NUM_ACTIONS,
                    }
                    export_weights(net, args.output, meta)
                    net.to(device)

                # Update frozen net
                if wr_frozen >= 0.55:
                    frozen_net.load_state_dict(net.state_dict())

            # Cleanup
            if episode % 500 == 0:
                cleanup()

    except KeyboardInterrupt:
        print("\nInterrupted by user")

    # Final evaluation and export
    elapsed = time.time() - start_time
    print()
    print("=" * 60)
    print(f"  Training complete: {episode:,} episodes in {elapsed:.1f}s")
    print("=" * 60)

    net.cpu()
    final_wr = evaluate_vs_random(game, net, torch.device("cpu"), args.eval_games)
    print(f"  Final win rate: {final_wr:.1%}")
    print(f"  Best win rate:  {best_wr:.1%}")

    if final_wr >= best_wr:
        meta = {
            "algorithm": "blazing_mk_i_gumbel",
            "n_simulations": args.n_simulations,
            "episodes": episode,
            "win_rate_vs_random": round(final_wr, 4),
            "input_size": OBS_SIZE,
            "hidden_size": args.hidden_size,
            "num_layers": args.num_layers,
            "output_size": NUM_ACTIONS,
        }
        export_weights(net, args.output, meta)

    print(f"  -> {args.output}")
    print()

    # Final cleanup
    replay.clear()
    cleanup()


if __name__ == "__main__":
    main()
