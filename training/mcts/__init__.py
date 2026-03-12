"""
IS-MCTS (Information Set Monte Carlo Tree Search) for Imposter Kings.

This module implements SO-ISMCTS (Single Observer IS-MCTS) with neural network
guidance for imperfect information games. Unlike determinized MCTS which builds
separate trees and averages (causing strategy fusion), IS-MCTS builds ONE tree
where nodes represent actions, not game states. Each iteration determinizes
hidden information differently but walks the same tree.

Key components:
- tree.py: ISMCTSNode and tree structure with availability-based UCB
- determinizer.py: clone_and_randomize for sampling consistent worlds
- search.py: The main IS-MCTS algorithm
- player.py: MCTSPlayer wrapper for evaluation and play

Reference:
    Cowling, Powley, Whitehouse (2012). "Information Set Monte Carlo Tree Search."
    IEEE Trans. on CI and AI in Games, 4(2):120-143.
"""

from .tree import ISMCTSNode
from .determinizer import clone_and_randomize
from .search import ismcts_search, ISMCTSConfig
from .player import MCTSPlayer

__all__ = [
    "ISMCTSNode",
    "ismcts_search",
    "ISMCTSConfig",
    "MCTSPlayer",
    "clone_and_randomize",
]
