"""
Intent-Conditioned MCTS Quattro — Hierarchical RL for Imposter Zero.

Key Innovation: Replace combinatorial mustering action sequences with
intent-based selection over feasible recruitment sets.

Research Foundation:
- AlphaStar: Autoregressive action decomposition
- Option-Critic: Advantage-based termination learning
- BDQ: Factorized action spaces with shared encoder
- HER: Goal-conditioned relabeling

Architecture:
- Shared encoder processes game state
- Phase router selects appropriate head
- Mustering head outputs over feasible recruitment INTENTS
- Intent executor (heuristic) realizes intent as primitive actions
- MCTS operates at intent level for mustering, primitives elsewhere

Usage:
  python train_ic_mcts_quattro.py --max_time 3600 --intent_mcts_iterations 50
"""

from __future__ import annotations

import argparse
import gc
import json
import math
import os
import pickle
import random
import time
from collections import defaultdict
from dataclasses import dataclass
from itertools import combinations
from multiprocessing import Pool, set_start_method
from typing import Dict, FrozenSet, List, Optional, Set, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F
import pyspiel

import imposter_zero.game as ig  # noqa: F401 — registers games

# Import shared utilities from train_ppo
from train_ppo import (
    League,
    OpponentType,
    OBS_SIZE,
    NUM_ACTIONS,
    raw_observation,
    select_opponent,
    compute_gae,
    evaluate_vs_random,
    evaluate_vs_frozen,
    export_weights,
    generate_timestamped_output,
    check_output_path,
    rotate_checkpoints,
)


# ---------------------------------------------------------------------------
# Mustering Intent System
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class MusteringIntent:
    """
    A high-level mustering decision.

    Represents: "I want to recruit these specific army cards"
    The execution (which hand cards to discard, which army cards to exhaust)
    is handled by a deterministic solver.
    """
    recruit_targets: FrozenSet[int]  # Army card IDs to recruit
    select_facet: Optional[str]  # 'charismatic', 'masterTactician', or None

    def __hash__(self):
        return hash((self.recruit_targets, self.select_facet))

    def __repr__(self):
        targets = list(self.recruit_targets)
        facet = f", facet={self.select_facet}" if self.select_facet else ""
        return f"Intent(recruit={targets}{facet})"


def enumerate_feasible_intents(state, player: int) -> List[MusteringIntent]:
    """
    Enumerate all feasible mustering intents for a player.

    Feasibility constraints:
    - Can only recruit as many cards as hand size allows
    - Each recruitment requires exhausting one army card
    - Facet selection only if not already chosen

    Returns list of MusteringIntent objects.
    """
    intents = []

    hand = state._hands[player]
    army_available = state._army_ids[player]
    current_facet = state._king_facets[player]

    max_recruits = min(len(hand), len(army_available))

    # Facet options
    facet_options = [None]
    if current_facet == "default":
        facet_options = [None, "charismatic", "masterTactician"]

    # Generate all recruitment subsets up to max_recruits
    for n_recruits in range(max_recruits + 1):
        for recruit_combo in combinations(army_available, n_recruits):
            recruit_set = frozenset(recruit_combo)
            for facet in facet_options:
                intents.append(MusteringIntent(
                    recruit_targets=recruit_set,
                    select_facet=facet
                ))

    return intents


def execute_intent(state, player: int, intent: MusteringIntent) -> List[int]:
    """
    Convert a high-level intent into a sequence of primitive actions.

    Execution heuristic:
    - Select facet first if specified
    - For each target to recruit:
      - Exhaust lowest-value available army card
      - Swap lowest-value hand card for the target
    - End mustering

    Returns list of encoded action integers.
    """
    actions = []
    mcid = state._max_card_id
    np = state._num_players

    # Track state as we build actions (don't mutate actual state)
    hand_available = list(state._hands[player])
    army_available = list(state._army_ids[player])
    exhausted_this_turn = []
    has_exhausted = state._has_exhausted_this_mustering
    current_facet = state._king_facets[player]

    # 1. Select facet if needed
    if intent.select_facet and current_facet == "default":
        facet_idx = 0 if intent.select_facet == "charismatic" else 1
        actions.append(ig._encode_select_king(facet_idx, mcid, np))

    # 2. Execute recruitments
    # Sort targets by value (recruit highest value first - strategic)
    targets_sorted = sorted(
        intent.recruit_targets,
        key=lambda cid: state._card_values.get(cid, 0),
        reverse=True
    )

    for target_id in targets_sorted:
        if not hand_available or target_id not in army_available:
            continue

        # Need to exhaust first if haven't this turn
        if not has_exhausted:
            # Exhaust lowest-value army card
            exhaust_card = min(
                army_available,
                key=lambda cid: state._card_values.get(cid, 0)
            )
            actions.append(ig._encode_begin_recruit(exhaust_card, mcid, np))
            army_available.remove(exhaust_card)
            exhausted_this_turn.append(exhaust_card)
            has_exhausted = True

        # Now recruit: discard lowest-value hand card to get target
        discard_card = min(
            hand_available,
            key=lambda cid: state._card_values.get(cid, 0)
        )
        actions.append(ig._encode_recruit(discard_card, target_id, mcid, np))
        hand_available.remove(discard_card)
        army_available.remove(target_id)
        hand_available.append(target_id)  # Got the target
        has_exhausted = False  # Reset for next potential recruit

    # 3. End mustering
    actions.append(ig._encode_end_mustering(mcid, np))

    return actions


def intent_value_estimate(state, player: int, intent: MusteringIntent) -> float:
    """
    Quick heuristic estimate of intent value for initialization.

    Higher score for:
    - Recruiting high-value cards
    - Discarding low-value cards
    - Net value gain
    """
    if not intent.recruit_targets:
        return 0.0

    hand = state._hands[player]

    # Value of cards we'll get
    recruit_value = sum(
        state._card_values.get(cid, 0)
        for cid in intent.recruit_targets
    )

    # Value of cards we'll discard (assuming lowest)
    hand_sorted = sorted(hand, key=lambda c: state._card_values.get(c, 0))
    n_discard = len(intent.recruit_targets)
    discard_value = sum(
        state._card_values.get(hand_sorted[i], 0)
        for i in range(min(n_discard, len(hand_sorted)))
    )

    # Net value gain, normalized
    net_gain = (recruit_value - discard_value) / 9.0

    # Bonus for facet selection
    facet_bonus = 0.1 if intent.select_facet else 0.0

    return net_gain + facet_bonus


# ---------------------------------------------------------------------------
# Intent-Conditioned Neural Network
# ---------------------------------------------------------------------------

class IntentConditionedNetwork(nn.Module):
    """
    Hierarchical network with phase-specific heads.

    Architecture:
    - Shared encoder: obs → hidden representation
    - Phase router: implicit in forward()
    - Phase heads:
      - Draft: 9 outputs
      - Crown: 2 outputs
      - Mustering: intent embedding + scoring
      - Setup/Play: standard action outputs
    - Value head: shared

    For mustering, we use a learned intent scorer that takes
    (state_embedding, intent_features) → scalar score.
    """

    def __init__(
        self,
        input_size: int,
        hidden_size: int,
        num_actions: int,
        num_layers: int = 4,
        max_intents: int = 512,
    ):
        super().__init__()

        self.input_size = input_size
        self.hidden_size = hidden_size
        self.num_actions = num_actions
        self.max_intents = max_intents

        # Shared encoder
        layers = []
        in_dim = input_size
        for i in range(num_layers - 1):
            layers.append(nn.Linear(in_dim, hidden_size))
            layers.append(nn.ReLU())
            in_dim = hidden_size
        self.encoder = nn.Sequential(*layers)

        # Standard policy head (for non-mustering phases)
        self.policy_head = nn.Linear(hidden_size, num_actions)

        # Value head
        self.value_head = nn.Linear(hidden_size, 1)

        # Intent scorer for mustering
        # Takes concatenation of state embedding + intent features
        self.intent_feature_size = 16  # Compact intent representation
        self.intent_scorer = nn.Sequential(
            nn.Linear(hidden_size + self.intent_feature_size, hidden_size // 2),
            nn.ReLU(),
            nn.Linear(hidden_size // 2, 1)
        )

        # Intent feature encoder
        self.intent_encoder = nn.Sequential(
            nn.Linear(32, self.intent_feature_size),  # 32 = max features per intent
            nn.ReLU(),
        )

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Standard forward for non-mustering phases."""
        h = self.encoder(x)
        logits = self.policy_head(h)
        value = self.value_head(h).squeeze(-1)
        return logits, value

    def policy(self, x: torch.Tensor) -> torch.Tensor:
        """Policy logits only."""
        h = self.encoder(x)
        return self.policy_head(h)

    def encode_state(self, x: torch.Tensor) -> torch.Tensor:
        """Get state embedding for intent scoring."""
        return self.encoder(x)

    def score_intents(
        self,
        state_embed: torch.Tensor,
        intent_features: torch.Tensor,
    ) -> torch.Tensor:
        """
        Score multiple intents given state embedding.

        Args:
            state_embed: (batch, hidden_size) state embeddings
            intent_features: (batch, n_intents, 32) raw intent features

        Returns:
            (batch, n_intents) intent scores
        """
        batch_size, n_intents, feat_dim = intent_features.shape

        # Encode intent features
        intent_feats = intent_features.view(-1, feat_dim)
        intent_encoded = self.intent_encoder(intent_feats)  # (batch*n, intent_feat_size)
        intent_encoded = intent_encoded.view(batch_size, n_intents, -1)

        # Expand state embedding
        state_expanded = state_embed.unsqueeze(1).expand(-1, n_intents, -1)

        # Concatenate and score
        combined = torch.cat([state_expanded, intent_encoded], dim=-1)
        scores = self.intent_scorer(combined).squeeze(-1)  # (batch, n_intents)

        return scores

    def value(self, x: torch.Tensor) -> torch.Tensor:
        """Value estimate only."""
        h = self.encoder(x)
        return self.value_head(h).squeeze(-1)


def encode_intent_features(state, player: int, intent: MusteringIntent) -> List[float]:
    """
    Encode a mustering intent as a fixed-size feature vector.

    Features (32 total):
    - Number of recruits (1)
    - Total recruit value (1)
    - Average recruit value (1)
    - Max recruit value (1)
    - Facet selection one-hot (3)
    - Per-card recruitment flags (8, padded)
    - Per-card values being recruited (8, padded)
    - Hand size after (1)
    - Net value gain (1)
    - Recruitment ratio (1)
    - Padding (6)
    """
    features = []

    hand = state._hands[player]
    army = state._army_ids[player]

    n_recruits = len(intent.recruit_targets)
    recruit_values = [state._card_values.get(cid, 0) for cid in intent.recruit_targets]

    # Basic stats
    features.append(n_recruits / 8.0)  # Normalized count
    features.append(sum(recruit_values) / 72.0)  # Total value (max ~72)
    features.append((sum(recruit_values) / max(n_recruits, 1)) / 9.0)  # Avg value
    features.append(max(recruit_values, default=0) / 9.0)  # Max value

    # Facet one-hot
    features.append(1.0 if intent.select_facet == "charismatic" else 0.0)
    features.append(1.0 if intent.select_facet == "masterTactician" else 0.0)
    features.append(1.0 if intent.select_facet is None else 0.0)

    # Per-card flags (which army cards being recruited)
    recruit_flags = [0.0] * 8
    recruit_card_values = [0.0] * 8
    for i, aid in enumerate(army[:8]):
        if aid in intent.recruit_targets:
            recruit_flags[i] = 1.0
            recruit_card_values[i] = state._card_values.get(aid, 0) / 9.0
    features.extend(recruit_flags)
    features.extend(recruit_card_values)

    # Derived features
    hand_after = len(hand) - n_recruits + n_recruits  # Same size
    features.append(hand_after / 9.0)

    # Net value gain
    hand_sorted = sorted(hand, key=lambda c: state._card_values.get(c, 0))
    discard_value = sum(
        state._card_values.get(hand_sorted[i], 0)
        for i in range(min(n_recruits, len(hand_sorted)))
    )
    net_gain = (sum(recruit_values) - discard_value) / 18.0  # Normalized
    features.append(net_gain)

    # Recruitment ratio
    features.append(n_recruits / max(len(army), 1))

    # Padding
    while len(features) < 32:
        features.append(0.0)

    return features[:32]


# ---------------------------------------------------------------------------
# Intent-Level MCTS
# ---------------------------------------------------------------------------

class IntentMCTSNode:
    """MCTS node for intent-level search in mustering phase."""

    def __init__(self, parent=None, intent: Optional[MusteringIntent] = None):
        self.parent = parent
        self.intent = intent
        self.children: Dict[MusteringIntent, IntentMCTSNode] = {}
        self.visit_count = 0
        self.value_sum = 0.0
        self.prior = 0.0

    @property
    def q_value(self) -> float:
        if self.visit_count == 0:
            return 0.0
        return self.value_sum / self.visit_count

    def ucb_score(self, c_puct: float, parent_visits: int) -> float:
        exploration = c_puct * self.prior * math.sqrt(parent_visits) / (1 + self.visit_count)
        return self.q_value + exploration

    def select_child(self, c_puct: float) -> Tuple[MusteringIntent, 'IntentMCTSNode']:
        best_score = -float('inf')
        best_intent = None
        best_child = None

        for intent, child in self.children.items():
            score = child.ucb_score(c_puct, self.visit_count)
            if score > best_score:
                best_score = score
                best_intent = intent
                best_child = child

        return best_intent, best_child

    def expand(self, intents: List[MusteringIntent], priors: List[float]):
        """Expand node with child nodes for each intent."""
        for intent, prior in zip(intents, priors):
            child = IntentMCTSNode(parent=self, intent=intent)
            child.prior = prior
            self.children[intent] = child

    def backpropagate(self, value: float):
        """Backpropagate value up the tree."""
        node = self
        while node is not None:
            node.visit_count += 1
            node.value_sum += value
            node = node.parent


def intent_mcts_search(
    state,
    player: int,
    net: IntentConditionedNetwork,
    intents: List[MusteringIntent],
    n_iterations: int,
    c_puct: float = 1.5,
    device: str = "cpu",
) -> Tuple[MusteringIntent, Dict[MusteringIntent, float]]:
    """
    Run MCTS at the intent level for mustering.

    Returns:
        best_intent: The selected intent
        policy: Dict mapping intent -> visit probability
    """
    if not intents:
        # Fallback: empty intent (just end mustering)
        empty_intent = MusteringIntent(frozenset(), None)
        return empty_intent, {empty_intent: 1.0}

    if len(intents) == 1:
        return intents[0], {intents[0]: 1.0}

    # Get initial prior from network
    obs = raw_observation(state, player)
    obs_t = torch.tensor([obs], dtype=torch.float32, device=device)

    with torch.no_grad():
        state_embed = net.encode_state(obs_t)

        # Encode all intents
        intent_features = []
        for intent in intents:
            feats = encode_intent_features(state, player, intent)
            intent_features.append(feats)

        intent_features_t = torch.tensor(
            [intent_features], dtype=torch.float32, device=device
        )

        scores = net.score_intents(state_embed, intent_features_t).squeeze(0)
        priors = F.softmax(scores, dim=0).cpu().numpy()

    # Initialize root
    root = IntentMCTSNode()
    root.expand(intents, priors.tolist())

    # Run MCTS iterations
    for _ in range(n_iterations):
        # Select
        node = root
        selected_intent = None

        if node.children:
            selected_intent, node = node.select_child(c_puct)

        # Evaluate (use network value + heuristic)
        if selected_intent is not None:
            heuristic_val = intent_value_estimate(state, player, selected_intent)

            # Simulate forward with this intent, get network value
            with torch.no_grad():
                value = net.value(obs_t).item()

            # Blend heuristic and network value
            combined_value = 0.7 * value + 0.3 * heuristic_val
        else:
            combined_value = 0.0

        # Backpropagate
        node.backpropagate(combined_value)

    # Extract policy from visit counts
    total_visits = sum(child.visit_count for child in root.children.values())
    policy = {}
    for intent, child in root.children.items():
        policy[intent] = child.visit_count / max(total_visits, 1)

    # Select best intent
    best_intent = max(root.children.keys(), key=lambda i: root.children[i].visit_count)

    return best_intent, policy


# ---------------------------------------------------------------------------
# Training Worker
# ---------------------------------------------------------------------------

def _worker_simulate_ic_mcts(args):
    """
    Worker function for generating episodes with intent-conditioned MCTS.

    Key differences from standard MCTS worker:
    - Mustering phase uses intent-level MCTS
    - Other phases use primitive actions
    - Trajectories include intent annotations
    """
    (weights_bytes, opponent_weights_bytes, opponent_type, n_episodes, seed,
     input_size, hidden_size, num_layers, num_actions,
     intent_mcts_iterations, mcts_c_puct, mcts_temperature,
     use_intent_mcts, max_intents) = args

    net = IntentConditionedNetwork(
        input_size, hidden_size, num_actions, num_layers, max_intents
    )
    net.load_state_dict(pickle.loads(weights_bytes))
    net.eval()

    # Opponent network
    opp_net = None
    if opponent_type == OpponentType.LEAGUE and opponent_weights_bytes is not None:
        opp_net = IntentConditionedNetwork(
            input_size, hidden_size, num_actions, num_layers, max_intents
        )
        opp_net.load_state_dict(pickle.loads(opponent_weights_bytes))
        opp_net.eval()

    game = pyspiel.load_game("imposter_zero_match")
    rng = random.Random(seed)
    results = []

    for _ in range(n_episodes):
        state = game.new_initial_state()

        obs_list = []
        act_list = []
        log_prob_list = []
        value_list = []
        player_list = []
        legal_list = []
        intent_annotations = []  # Track intent decisions

        pending_intent_actions = []  # Queue of actions from intent execution
        current_intent = None

        while not state.is_terminal():
            player = state.current_player()
            if player < 0:
                break

            legal = state.legal_actions()
            if not legal:
                break

            obs = raw_observation(state, player)

            if player == 0:
                phase = getattr(state, "_phase", "play")

                # Check if we have pending actions from intent execution
                if pending_intent_actions:
                    action = pending_intent_actions.pop(0)

                    # Get log_prob and value from network
                    with torch.no_grad():
                        obs_t = torch.tensor([obs], dtype=torch.float32)
                        logits, value = net(obs_t)
                        value = value.item()

                    if action in legal:
                        mask = torch.full((num_actions,), -1e9)
                        for a in legal:
                            mask[a] = 0.0
                        log_probs = F.log_softmax(logits.squeeze(0) + mask, dim=0)
                        log_prob = log_probs[action].item()
                    else:
                        # Fallback if action not legal (shouldn't happen)
                        action = legal[0]
                        log_prob = 0.0

                    obs_list.append(obs)
                    act_list.append(action)
                    log_prob_list.append(log_prob)
                    value_list.append(value)
                    player_list.append(player)
                    legal_list.append(legal)
                    intent_annotations.append(current_intent)

                # Mustering phase with intent MCTS
                elif phase == "mustering" and use_intent_mcts:
                    intents = enumerate_feasible_intents(state, player)

                    if len(intents) > 1:
                        # Run intent MCTS
                        best_intent, policy = intent_mcts_search(
                            state, player, net, intents,
                            n_iterations=intent_mcts_iterations,
                            c_puct=mcts_c_puct,
                            device="cpu"
                        )

                        # Sample from policy with temperature
                        if mcts_temperature > 0:
                            intent_items = list(policy.items())
                            probs = [p ** (1.0 / mcts_temperature) for _, p in intent_items]
                            total = sum(probs)
                            probs = [p / total for p in probs]
                            chosen_idx = random.choices(range(len(intent_items)), weights=probs)[0]
                            chosen_intent = intent_items[chosen_idx][0]
                        else:
                            chosen_intent = best_intent

                        current_intent = chosen_intent

                        # Execute intent to get primitive actions
                        intent_actions = execute_intent(state, player, chosen_intent)

                        if intent_actions:
                            pending_intent_actions = intent_actions[1:]  # Queue rest
                            action = intent_actions[0]

                            with torch.no_grad():
                                obs_t = torch.tensor([obs], dtype=torch.float32)
                                logits, value = net(obs_t)
                                value = value.item()

                            if action in legal:
                                mask = torch.full((num_actions,), -1e9)
                                for a in legal:
                                    mask[a] = 0.0
                                log_probs = F.log_softmax(logits.squeeze(0) + mask, dim=0)
                                log_prob = log_probs[action].item()
                            else:
                                action = legal[0]
                                log_prob = 0.0

                            obs_list.append(obs)
                            act_list.append(action)
                            log_prob_list.append(log_prob)
                            value_list.append(value)
                            player_list.append(player)
                            legal_list.append(legal)
                            intent_annotations.append(current_intent)
                        else:
                            # No actions from intent, use standard selection
                            action = legal[0] if legal else 0
                            with torch.no_grad():
                                obs_t = torch.tensor([obs], dtype=torch.float32)
                                _, value = net(obs_t)
                                value = value.item()
                            log_prob = 0.0

                            obs_list.append(obs)
                            act_list.append(action)
                            log_prob_list.append(log_prob)
                            value_list.append(value)
                            player_list.append(player)
                            legal_list.append(legal)
                            intent_annotations.append(None)
                    else:
                        # Single intent or no intents
                        if intents:
                            chosen_intent = intents[0]
                            intent_actions = execute_intent(state, player, chosen_intent)
                            if intent_actions:
                                action = intent_actions[0]
                                pending_intent_actions = intent_actions[1:]
                                current_intent = chosen_intent
                            else:
                                action = legal[0]
                        else:
                            action = legal[0]

                        with torch.no_grad():
                            obs_t = torch.tensor([obs], dtype=torch.float32)
                            logits, value = net(obs_t)
                            value = value.item()

                        if action in legal:
                            mask = torch.full((num_actions,), -1e9)
                            for a in legal:
                                mask[a] = 0.0
                            log_probs = F.log_softmax(logits.squeeze(0) + mask, dim=0)
                            log_prob = log_probs[action].item()
                        else:
                            action = legal[0]
                            log_prob = 0.0

                        obs_list.append(obs)
                        act_list.append(action)
                        log_prob_list.append(log_prob)
                        value_list.append(value)
                        player_list.append(player)
                        legal_list.append(legal)
                        intent_annotations.append(current_intent)

                else:
                    # Standard action selection for non-mustering phases
                    current_intent = None

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
                    intent_annotations.append(None)

            else:
                # Opponent action selection
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
                    # Self-play
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
        results.append((
            obs_list, act_list, log_prob_list, value_list,
            player_list, legal_list, returns[0], intent_annotations
        ))

    return results


# ---------------------------------------------------------------------------
# Main Training Loop
# ---------------------------------------------------------------------------

def main():
    try:
        set_start_method("spawn")
    except RuntimeError:
        pass

    parser = argparse.ArgumentParser(
        description="Intent-Conditioned MCTS Quattro trainer"
    )

    # Training parameters
    parser.add_argument("--episodes", type=int, default=5_000_000)
    parser.add_argument("--max_time", type=int, default=0)
    parser.add_argument("--num_workers", type=int, default=12)
    parser.add_argument("--episodes_per_worker", type=int, default=12)

    # Network architecture
    parser.add_argument("--hidden_size", type=int, default=512)
    parser.add_argument("--num_layers", type=int, default=4)
    parser.add_argument("--max_intents", type=int, default=512)

    # PPO hyperparameters
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--entropy_coeff", type=float, default=0.05)
    parser.add_argument("--clip_ratio", type=float, default=0.2)
    parser.add_argument("--value_coeff", type=float, default=0.5)
    parser.add_argument("--gamma", type=float, default=0.99)
    parser.add_argument("--gae_lambda", type=float, default=0.95)
    parser.add_argument("--ppo_epochs", type=int, default=4)
    parser.add_argument("--minibatch_size", type=int, default=4096)

    # Curriculum
    parser.add_argument("--curriculum_random_until", type=int, default=10_000)
    parser.add_argument("--curriculum_self_until", type=int, default=50_000)
    parser.add_argument("--league_size", type=int, default=20)
    parser.add_argument("--league_add_every", type=int, default=20_000)

    # Intent MCTS parameters
    parser.add_argument("--intent_mcts_fraction", type=float, default=0.5,
                        help="Fraction of episodes using intent MCTS")
    parser.add_argument("--intent_mcts_iterations", type=int, default=50,
                        help="MCTS iterations at intent level")
    parser.add_argument("--intent_mcts_c_puct", type=float, default=1.5)
    parser.add_argument("--intent_mcts_temperature", type=float, default=1.0)
    parser.add_argument("--intent_mcts_start_after", type=int, default=5_000)

    # Evaluation
    parser.add_argument("--eval_every", type=int, default=10_000)
    parser.add_argument("--eval_games", type=int, default=500)
    parser.add_argument("--frozen_update_every", type=int, default=50_000)

    # Output
    parser.add_argument("--output", type=str, default=None)
    parser.add_argument("--output_prefix", type=str, default="policy_ic_mcts")
    parser.add_argument("--keep_checkpoints", type=int, default=5)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--patience", type=int, default=0)
    parser.add_argument("--resume", type=str, default=None)
    parser.add_argument("--max_batch_samples", type=int, default=50_000)
    parser.add_argument("--cleanup_every", type=int, default=100)

    args = parser.parse_args()

    if args.output is None:
        args.output = generate_timestamped_output("./training", args.output_prefix)
        print(f"  Using timestamped output: {args.output}")

    check_output_path(args.output, args.resume)

    if args.seed is not None:
        random.seed(args.seed)
        torch.manual_seed(args.seed)

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    game = pyspiel.load_game("imposter_zero_match")

    # Initialize networks
    net = IntentConditionedNetwork(
        OBS_SIZE, args.hidden_size, NUM_ACTIONS,
        args.num_layers, args.max_intents
    ).to(device)

    frozen_net = IntentConditionedNetwork(
        OBS_SIZE, args.hidden_size, NUM_ACTIONS,
        args.num_layers, args.max_intents
    ).to(device)

    league = League(max_size=args.league_size)

    if args.resume:
        with open(args.resume) as f:
            resume_data = json.load(f)
        rw = resume_data["weights"]
        sd = net.state_dict()
        linear_keys = [(k.rsplit(".", 1)[0], k) for k in sd if k.endswith(".weight")]
        linear_keys.sort(key=lambda t: t[1])
        for i, (prefix, wkey) in enumerate(linear_keys):
            if f"w{i+1}" in rw:
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

    frozen_net.load_state_dict(net.state_dict())

    optimizer = torch.optim.Adam(net.parameters(), lr=args.lr)
    batch_size = args.num_workers * args.episodes_per_worker
    n_params = sum(p.numel() for p in net.parameters())

    print()
    print("=" * 70)
    print("  Imposter Zero — Intent-Conditioned MCTS Quattro Training")
    print("=" * 70)
    print()
    print(f"  Device:           {device}")
    print(f"  Network:          IntentConditionedNetwork")
    print(f"                    {OBS_SIZE} -> {args.hidden_size}x{args.num_layers-1} -> {NUM_ACTIONS}")
    print(f"  Parameters:       {n_params:,}")
    print(f"  Max intents:      {args.max_intents}")
    print()
    print("  Algorithm:        PPO + Intent-Level MCTS")
    print(f"                    clip={args.clip_ratio}, ent={args.entropy_coeff}")
    print(f"  Intent MCTS:      {args.intent_mcts_fraction:.0%} episodes")
    print(f"                    {args.intent_mcts_iterations} iterations, c_puct={args.intent_mcts_c_puct}")
    print()
    print(f"  Curriculum:       random<{args.curriculum_random_until:,}, self<{args.curriculum_self_until:,}, then league")
    print(f"  Workers:          {args.num_workers} x {args.episodes_per_worker} eps/worker")
    print(f"  LR:               {args.lr}")
    print()
    if args.max_time > 0:
        h, m = divmod(args.max_time, 3600)
        m //= 60
        print(f"  Max time:         {args.max_time}s ({h}h {m}m)")
    else:
        print(f"  Max time:         unlimited (max {args.episodes:,} episodes)")
    print(f"  Output:           {args.output}")
    print()
    print("=" * 70)
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
    intent_mcts_episodes = 0
    standard_episodes = 0

    pool = Pool(processes=args.num_workers)

    try:
        while episode < args.episodes:
            if args.max_time > 0 and (time.time() - start_time) >= args.max_time:
                stop_reason = "time_limit"
                break

            opponent_type = select_opponent(
                episode, args.curriculum_random_until,
                args.curriculum_self_until, league
            )

            opponent_weights = None
            if opponent_type == OpponentType.LEAGUE:
                opponent_weights = league.sample()
                if opponent_weights is None:
                    opponent_type = OpponentType.SELF

            net.cpu()
            weights_bytes = pickle.dumps(net.state_dict())
            net.to(device)

            use_intent_mcts_enabled = (
                episode >= args.intent_mcts_start_after and
                args.intent_mcts_fraction > 0
            )

            base_seed = random.randint(0, 2**31)
            worker_args = []
            for i in range(args.num_workers):
                use_intent_mcts = (
                    use_intent_mcts_enabled and
                    (random.random() < args.intent_mcts_fraction)
                )
                worker_args.append((
                    weights_bytes, opponent_weights, opponent_type,
                    args.episodes_per_worker, base_seed + i,
                    OBS_SIZE, args.hidden_size, args.num_layers, NUM_ACTIONS,
                    args.intent_mcts_iterations, args.intent_mcts_c_puct,
                    args.intent_mcts_temperature, use_intent_mcts,
                    args.max_intents
                ))

            all_results = pool.map(_worker_simulate_ic_mcts, worker_args)

            for i, wa in enumerate(worker_args):
                if wa[-2]:  # use_intent_mcts flag
                    intent_mcts_episodes += args.episodes_per_worker
                else:
                    standard_episodes += args.episodes_per_worker

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
                     player_list, legal_list, final_return, intent_ann) in worker_eps:
                    if not obs_list:
                        continue

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

            try:
                obs_t = torch.tensor(flat_obs, dtype=torch.float32, device=device)
                acts_t = torch.tensor(flat_acts, dtype=torch.long, device=device)
                old_log_probs_t = torch.tensor(flat_old_log_probs, dtype=torch.float32, device=device)
                returns_t = torch.tensor(flat_returns, dtype=torch.float32, device=device)
                advantages_t = torch.tensor(flat_advantages, dtype=torch.float32, device=device)

                advantages_t = (advantages_t - advantages_t.mean()) / (advantages_t.std() + 1e-8)

                masks_t = torch.full((n_samples, NUM_ACTIONS), -1e9, device=device)
                for i, legal in enumerate(flat_legal):
                    masks_t[i, legal] = 0.0

                total_policy_loss = 0.0
                total_value_loss = 0.0
                total_entropy = 0.0

                for _ in range(args.ppo_epochs):
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

                        logits, values = net(mb_obs)
                        logits = logits.clamp(-50, 50)

                        masked_logits = logits + mb_masks
                        log_probs = F.log_softmax(masked_logits, dim=1)
                        new_log_probs = log_probs.gather(1, mb_acts.unsqueeze(1)).squeeze(1)

                        ratio = torch.exp(new_log_probs - mb_old_lp)
                        surr1 = ratio * mb_adv
                        surr2 = torch.clamp(ratio, 1 - args.clip_ratio, 1 + args.clip_ratio) * mb_adv
                        policy_loss = -torch.min(surr1, surr2).mean()

                        value_loss = F.mse_loss(values, mb_returns)

                        probs = F.softmax(masked_logits, dim=1)
                        entropy_terms = probs * log_probs
                        entropy = -torch.nan_to_num(entropy_terms, nan=0.0).sum(dim=1).mean()

                        loss = (
                            policy_loss +
                            args.value_coeff * value_loss -
                            args.entropy_coeff * entropy
                        )

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

            except Exception as e:
                print(f"  Warning: Batch failed ({e}), skipping")
                continue

            batch_count += 1

            # Periodic reporting
            now = time.time()
            if now - last_report >= 60:
                elapsed = now - start_time
                eps_per_sec = episode / elapsed if elapsed > 0 else 0
                intent_pct = intent_mcts_episodes / max(1, intent_mcts_episodes + standard_episodes) * 100
                print(
                    f"[{elapsed/60:.0f}m] {episode:,} eps ({eps_per_sec:.1f}/s) "
                    f"| Intent-MCTS: {intent_pct:.0f}% "
                    f"| p_loss={avg_policy_loss:.4f} "
                    f"| v_loss={avg_value_loss:.4f} "
                    f"| entropy={avg_entropy:.4f}"
                )
                last_report = now

            if batch_count % args.cleanup_every == 0:
                gc.collect()

            # League management
            if episode - last_league_add >= args.league_add_every:
                wr_for_league = evaluate_vs_random(game, net, device, num_games=100)
                net.cpu()
                wb = pickle.dumps(net.state_dict())
                net.to(device)
                league.add(episode, wb, wr_for_league)
                last_league_add = episode

            # Frozen update
            if episode - last_frozen_update >= args.frozen_update_every:
                wr_frozen = evaluate_vs_frozen(game, net, frozen_net, device, num_games=100)
                if wr_frozen >= 0.55:
                    frozen_net.load_state_dict(net.state_dict())
                    last_frozen_update = episode
                    print(f"  -> Updated frozen checkpoint (wr_frozen={wr_frozen:.1%})")

            # Evaluation
            if episode % args.eval_every < batch_size:
                wr_random = evaluate_vs_random(game, net, device, args.eval_games)
                wr_frozen = evaluate_vs_frozen(game, net, frozen_net, device, args.eval_games // 2)
                elapsed = time.time() - start_time
                intent_pct = intent_mcts_episodes / max(1, intent_mcts_episodes + standard_episodes) * 100

                print(
                    f"[Eval {episode:,}] vs-random={wr_random:.1%} vs-frozen={wr_frozen:.1%} "
                    f"| best={best_wr_random:.1%} | Intent-MCTS={intent_pct:.0f}% "
                    f"| {elapsed/60:.0f}m elapsed"
                )

                if wr_random > best_wr_random:
                    best_wr_random = wr_random
                    evals_without_improvement = 0
                    net.cpu()
                    meta = {
                        "algorithm": "ppo_ic_mcts_quattro",
                        "action_space": "intent_conditioned",
                        "num_players": 2,
                        "game": "imposter_zero_match",
                        "game_version": "4.0-intent-mcts",
                        "input_size": OBS_SIZE,
                        "hidden_size": args.hidden_size,
                        "num_layers": args.num_layers,
                        "output_size": NUM_ACTIONS,
                        "num_actions": NUM_ACTIONS,
                        "max_intents": args.max_intents,
                        "episodes": episode,
                        "win_rate_vs_random": round(wr_random, 4),
                        "win_rate_vs_frozen": round(wr_frozen, 4),
                        "intent_mcts_fraction": args.intent_mcts_fraction,
                        "intent_mcts_iterations": args.intent_mcts_iterations,
                        "entropy_coeff": args.entropy_coeff,
                        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    }
                    export_weights(
                        net, args.output, meta,
                        rotate_prefix=args.output_prefix if args.keep_checkpoints > 0 else None,
                        rotate_dir="./training",
                        keep_checkpoints=args.keep_checkpoints
                    )
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
    intent_pct = intent_mcts_episodes / max(1, intent_mcts_episodes + standard_episodes) * 100

    print()
    print("=" * 70)
    print(f"  Training finished: {episode:,} episodes in {elapsed:.1f}s ({stop_reason})")
    print("=" * 70)
    print(f"  Intent-MCTS episodes: {intent_mcts_episodes:,} ({intent_pct:.0f}%)")
    print(f"  Standard episodes:    {standard_episodes:,}")
    print()

    net.cpu()
    wr = evaluate_vs_random(game, net, torch.device("cpu"), args.eval_games)
    print(f"  Final win rate vs random: {wr:.1%}")
    print(f"  Best win rate vs random:  {best_wr_random:.1%}")
    print(f"  Best win rate vs frozen:  {best_wr_frozen:.1%}")

    if wr >= best_wr_random:
        meta = {
            "algorithm": "ppo_ic_mcts_quattro",
            "action_space": "intent_conditioned",
            "num_players": 2,
            "game": "imposter_zero_match",
            "game_version": "4.0-intent-mcts",
            "input_size": OBS_SIZE,
            "hidden_size": args.hidden_size,
            "num_layers": args.num_layers,
            "output_size": NUM_ACTIONS,
            "num_actions": NUM_ACTIONS,
            "max_intents": args.max_intents,
            "episodes": episode,
            "win_rate_vs_random": round(wr, 4),
            "intent_mcts_fraction": args.intent_mcts_fraction,
            "intent_mcts_iterations": args.intent_mcts_iterations,
            "entropy_coeff": args.entropy_coeff,
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        export_weights(
            net, args.output, meta,
            rotate_prefix=args.output_prefix if args.keep_checkpoints > 0 else None,
            rotate_dir="./training",
            keep_checkpoints=args.keep_checkpoints
        )

    print()
    print(f"  -> Exported: {args.output}")
    print()


if __name__ == "__main__":
    main()
