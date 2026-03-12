"""
SO-ISMCTS (Single Observer Information Set MCTS) search algorithm.

This implements the core IS-MCTS algorithm with neural network guidance.
Unlike determinized MCTS, we build ONE tree shared across all determinizations.
Each iteration:
1. Determinize: sample hidden info consistent with observer's knowledge
2. Select: walk down the tree, filtering by legal actions in this world
3. Expand: add child node for an untried legal action
4. Evaluate: use neural network to estimate position value
5. Backpropagate: update statistics along the path

Reference:
    Cowling, Powley, Whitehouse (2012). "Information Set Monte Carlo Tree Search."
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, TYPE_CHECKING

import torch
import torch.nn.functional as F

from .tree import ISMCTSNode
from .determinizer import clone_and_randomize
from train_ppo import raw_observation

if TYPE_CHECKING:
    import torch.nn as nn


@dataclass
class ISMCTSConfig:
    """Configuration for IS-MCTS search."""

    num_iterations: int = 200  # Simulations per decision
    c_puct: float = 1.5  # Exploration constant
    temperature: float = 1.0  # Temperature for action selection
    device: str = "cpu"  # Device for neural network


def ismcts_search(
    state,
    observer: int,
    network: "nn.Module",
    config: Optional[ISMCTSConfig] = None,
) -> Tuple[ISMCTSNode, Dict[int, float]]:
    """
    Run SO-ISMCTS from the observer's perspective.

    This builds ONE tree across all iterations. Each iteration determinizes
    the hidden info differently but walks the same tree, filtering at each
    level by what's legal in that particular determinization.

    Args:
        state: The real game state (not cloned - we clone internally)
        observer: The player ID whose perspective we're searching from
        network: Neural network with policy and value heads
        config: Search configuration

    Returns:
        root: The root node of the search tree
        improved_policy: Dict mapping legal actions to probabilities
    """
    if config is None:
        config = ISMCTSConfig()

    root = ISMCTSNode()
    rng = random.Random()

    # Get legal actions from the actual state (not determinized)
    real_legal_actions = state.legal_actions()
    if not real_legal_actions:
        return root, {}

    for _iteration in range(config.num_iterations):
        node = root

        # ── Step 1: DETERMINIZE ──
        # Clone and randomize hidden info not visible to observer
        det_state = clone_and_randomize(state, observer, rng)

        # ── Step 2: SELECT ──
        # Walk down the tree. At each node, filter by legal actions
        # in this determinization.
        path: List[Tuple[ISMCTSNode, int]] = []
        legal_actions = det_state.legal_actions()

        while legal_actions:
            # Check for untried actions
            untried = node.get_untried_actions(legal_actions)

            if untried:
                # ── Step 3: EXPAND ──
                # Use neural network prior to choose which untried action to expand
                current_player = det_state.current_player()
                obs = raw_observation(det_state, current_player)
                policy_probs, _ = _evaluate_network(network, obs, config.device)

                # Pick the untried action with highest prior
                action = max(untried, key=lambda a: policy_probs.get(a, 0.0))
                prior = policy_probs.get(action, 0.0)

                det_state._apply_action(action)
                child = node.add_child(action, current_player, prior)
                path.append((child, action))
                node = child
                break

            # All legal actions have been tried - use PUCT selection
            selected = node.select_child(legal_actions, config.c_puct)
            if selected is None:
                break

            path.append((selected, selected.action))
            det_state._apply_action(selected.action)
            node = selected
            legal_actions = det_state.legal_actions()

        # ── Step 4: EVALUATE ──
        # Use neural network to estimate value, or terminal outcome
        if det_state.is_terminal():
            returns = det_state.returns()
            value = returns[observer]
        else:
            current_player = det_state.current_player()
            obs = raw_observation(det_state, current_player)
            _, value = _evaluate_network(network, obs, config.device)

            # Convert to observer's perspective
            if current_player != observer:
                value = 1.0 - value  # Zero-sum assumption

        # ── Step 5: BACKPROPAGATE ──
        # Walk back up, updating visit counts and values
        for node, _action in reversed(path):
            node.visits += 1
            # Value is from observer's perspective
            # If the node was created by observer, use value directly
            # If by opponent, use 1-value (zero-sum)
            if node.player_just_moved == observer:
                node.total_value += value
            else:
                node.total_value += 1.0 - value

    # Extract improved policy from root visit counts
    improved_policy = root.visit_distribution(real_legal_actions, config.temperature)

    return root, improved_policy


def _evaluate_network(
    network: "nn.Module", obs: List[float], device: str
) -> Tuple[Dict[int, float], float]:
    """
    Evaluate position using neural network.

    Returns:
        policy: Dict mapping action indices to probabilities
        value: Scalar value estimate in [0, 1]
    """
    obs_tensor = torch.tensor([obs], dtype=torch.float32, device=device)

    with torch.no_grad():
        logits, value = network(obs_tensor)

    # Convert logits to probabilities
    probs = F.softmax(logits.squeeze(0), dim=0).cpu().numpy()

    # Create dict mapping action -> probability
    policy = {a: float(probs[a]) for a in range(len(probs))}

    # Value head outputs in [-1, 1], convert to [0, 1] for win probability
    value_scalar = (value.item() + 1.0) / 2.0

    return policy, value_scalar


def should_use_search(state, legal_actions: List[int]) -> bool:
    """
    Determine if IS-MCTS search is warranted for this decision.

    Skip search for trivial decisions to save computation:
    - Only 1-2 legal actions (no real choice)
    - Forced plays (antechamber, condemned)
    """
    if len(legal_actions) <= 2:
        return False

    # Check for forced play phases
    phase = getattr(state, "_phase", None)
    if phase in ("draft_select", "draft_order", "draft_pick"):
        # Draft decisions might benefit from search, but are complex
        # to evaluate. Skip for now.
        return False

    return True


def sample_action(policy: Dict[int, float], temperature: float = 1.0) -> int:
    """
    Sample an action from the policy distribution.

    With temperature=1.0, samples proportionally.
    With temperature->0, approaches argmax (greedy).
    """
    if not policy:
        raise ValueError("Empty policy")

    if temperature <= 0:
        return max(policy.keys(), key=lambda a: policy[a])

    # Temperature scaling
    actions = list(policy.keys())
    probs = [policy[a] ** (1.0 / temperature) for a in actions]
    total = sum(probs)
    probs = [p / total for p in probs]

    return random.choices(actions, weights=probs, k=1)[0]


def get_best_action(root: ISMCTSNode, legal_actions: List[int]) -> int:
    """Get the most visited action from search tree."""
    return root.best_action(legal_actions)
