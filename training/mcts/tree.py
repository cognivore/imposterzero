"""
IS-MCTS tree structure with availability-based UCB.

In IS-MCTS, nodes represent ACTIONS (from the observer's perspective), not game
states. The same node may be visited under many different determinizations.

Key difference from standard MCTS: we track 'avails' (how many times this node
was AVAILABLE for selection, i.e., the action was legal in the determinization),
not just 'visits' (how many times it was actually selected). This is critical
for correct UCB calculation in IS-MCTS.

UCB formula for IS-MCTS:
    UCB_ISMCTS(node) = Q(node) + c * P(node) * sqrt(avails) / (1 + visits)

Where:
    - Q(node) = mean backed-up value
    - P(node) = neural network prior
    - avails = times this node was available (legal)
    - visits = times this node was selected
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional


class ISMCTSNode:
    """
    A node in the information set tree.

    Each node represents an action taken from the observer's perspective.
    Statistics accumulate across all determinizations where this action
    was taken.
    """

    __slots__ = (
        "action",
        "parent",
        "children",
        "visits",
        "avails",
        "total_value",
        "player_just_moved",
        "nn_prior",
    )

    def __init__(
        self,
        action: Optional[int] = None,
        parent: Optional[ISMCTSNode] = None,
        player_just_moved: Optional[int] = None,
    ):
        self.action = action  # The action that led here (None for root)
        self.parent = parent
        self.children: Dict[int, ISMCTSNode] = {}  # action -> child node

        self.visits = 0  # Times this node was selected
        self.avails = 0  # Times this node was available (legal)
        self.total_value = 0.0  # Sum of backed-up values

        self.player_just_moved = player_just_moved
        self.nn_prior = 0.0  # Policy prior from neural network

    @property
    def mean_value(self) -> float:
        """Average value across all visits."""
        return self.total_value / self.visits if self.visits > 0 else 0.0

    def get_untried_actions(self, legal_actions: List[int]) -> List[int]:
        """Actions legal in this determinization that don't have child nodes yet."""
        return [a for a in legal_actions if a not in self.children]

    def get_legal_children(self, legal_actions: List[int]) -> List[ISMCTSNode]:
        """Child nodes whose actions are legal in this determinization."""
        legal_set = set(legal_actions)
        return [c for c in self.children.values() if c.action in legal_set]

    def add_child(self, action: int, player: int, prior: float = 0.0) -> ISMCTSNode:
        """Create and add a child node for the given action."""
        child = ISMCTSNode(action=action, parent=self, player_just_moved=player)
        child.nn_prior = prior
        child.avails = 1  # First time being available
        self.children[action] = child
        return child

    def select_child(
        self, legal_actions: List[int], c_puct: float = 1.5
    ) -> Optional[ISMCTSNode]:
        """
        Select a child node using PUCT adapted for information sets.

        Only considers children legal in the current determinization.
        Updates avails for all legal children before selection.

        PUCT formula for IS-MCTS:
            score = Q + c_puct * P * sqrt(avails) / (1 + visits)
        """
        legal_children = self.get_legal_children(legal_actions)
        if not legal_children:
            return None

        # Update availability counts for all legal children
        for child in legal_children:
            child.avails += 1

        # PUCT selection
        def puct_score(child: ISMCTSNode) -> float:
            q = child.mean_value
            u = c_puct * child.nn_prior * math.sqrt(child.avails) / (1 + child.visits)
            return q + u

        return max(legal_children, key=puct_score)

    def visit_distribution(
        self, legal_actions: List[int], temperature: float = 1.0
    ) -> Dict[int, float]:
        """
        Get action probability distribution from visit counts.

        With temperature=1.0, probabilities are proportional to visit counts.
        With temperature->0, converges to argmax (greedy).
        """
        if temperature <= 0:
            # Greedy: all mass on most visited
            best_action = max(
                legal_actions,
                key=lambda a: self.children[a].visits if a in self.children else 0,
            )
            return {a: 1.0 if a == best_action else 0.0 for a in legal_actions}

        # Temperature-scaled visit counts
        counts = {}
        for a in legal_actions:
            if a in self.children:
                counts[a] = self.children[a].visits ** (1.0 / temperature)
            else:
                counts[a] = 0.0

        total = sum(counts.values())
        if total == 0:
            # Uniform if no visits
            n = len(legal_actions)
            return {a: 1.0 / n for a in legal_actions}

        return {a: counts[a] / total for a in legal_actions}

    def best_action(self, legal_actions: List[int]) -> Optional[int]:
        """Return the most visited legal action."""
        best = None
        best_visits = -1
        for a in legal_actions:
            if a in self.children and self.children[a].visits > best_visits:
                best = a
                best_visits = self.children[a].visits
        return best

    def __repr__(self) -> str:
        return (
            f"ISMCTSNode(action={self.action}, visits={self.visits}, "
            f"avails={self.avails}, value={self.mean_value:.3f})"
        )
