"""
MCTS-based player for evaluation and play.

This module provides a MCTSPlayer class that wraps the IS-MCTS search
for use in evaluation against other strategies.
"""

from __future__ import annotations

import random
from typing import List, TYPE_CHECKING

import torch

from .search import (
    ISMCTSConfig,
    ismcts_search,
    should_use_search,
    sample_action,
    get_best_action,
)
from train_ppo import raw_observation

if TYPE_CHECKING:
    import torch.nn as nn


class MCTSPlayer:
    """
    Player that uses IS-MCTS for action selection.

    Can be used for evaluation, interactive play, or training data generation.
    """

    def __init__(
        self,
        network: "nn.Module",
        num_iterations: int = 200,
        c_puct: float = 1.5,
        temperature: float = 1.0,
        device: str = "cpu",
        skip_trivial: bool = True,
    ):
        """
        Initialize MCTS player.

        Args:
            network: Neural network with policy and value heads
            num_iterations: Number of MCTS iterations per decision
            c_puct: Exploration constant
            temperature: Temperature for action sampling (1.0=proportional, 0=greedy)
            device: Device for neural network inference
            skip_trivial: If True, skip search for trivial decisions
        """
        self.network = network
        self.config = ISMCTSConfig(
            num_iterations=num_iterations,
            c_puct=c_puct,
            temperature=temperature,
            device=device,
        )
        self.skip_trivial = skip_trivial

        # Ensure network is in eval mode
        self.network.eval()

    def select_action(
        self,
        state,
        player: int,
        deterministic: bool = False,
    ) -> int:
        """
        Select an action using IS-MCTS.

        Args:
            state: The current game state
            player: The player ID to act for
            deterministic: If True, always select best action (no sampling)

        Returns:
            The selected action
        """
        legal_actions = state.legal_actions()

        if not legal_actions:
            raise ValueError("No legal actions available")

        if len(legal_actions) == 1:
            return legal_actions[0]

        # Skip search for trivial decisions if configured
        if self.skip_trivial and not should_use_search(state, legal_actions):
            return self._raw_network_action(state, player, legal_actions, deterministic)

        # Run IS-MCTS search
        root, improved_policy = ismcts_search(
            state,
            player,
            self.network,
            self.config,
        )

        if deterministic:
            return get_best_action(root, legal_actions)
        else:
            return sample_action(improved_policy, self.config.temperature)

    def select_action_with_policy(
        self, state, player: int
    ) -> tuple[int, dict[int, float]]:
        """
        Select an action and return the improved policy.

        Useful for training data generation where we want both
        the action and the MCTS policy distribution.

        Args:
            state: The current game state
            player: The player ID to act for

        Returns:
            Tuple of (selected action, policy distribution)
        """
        legal_actions = state.legal_actions()

        if not legal_actions:
            raise ValueError("No legal actions available")

        if len(legal_actions) == 1:
            return legal_actions[0], {legal_actions[0]: 1.0}

        # Run IS-MCTS search
        root, improved_policy = ismcts_search(
            state,
            player,
            self.network,
            self.config,
        )

        action = sample_action(improved_policy, self.config.temperature)
        return action, improved_policy

    def _raw_network_action(
        self,
        state,
        player: int,
        legal_actions: List[int],
        deterministic: bool,
    ) -> int:
        """
        Raw network action selection (no search).

        Used when search is skipped for trivial decisions.
        """
        obs = raw_observation(state, player)
        obs_tensor = torch.tensor([obs], dtype=torch.float32, device=self.config.device)

        with torch.no_grad():
            logits, _ = self.network(obs_tensor)

        # Mask illegal actions
        logits = logits.squeeze(0)
        mask = torch.full_like(logits, float("-inf"))
        for a in legal_actions:
            mask[a] = 0.0
        logits = logits + mask

        if deterministic:
            return logits.argmax().item()
        else:
            probs = torch.softmax(logits, dim=0)
            return torch.multinomial(probs, 1).item()


class RandomPlayer:
    """Random action player for comparison."""

    def select_action(self, state, player: int, deterministic: bool = False) -> int:
        legal_actions = state.legal_actions()
        if not legal_actions:
            raise ValueError("No legal actions available")
        return random.choice(legal_actions)


def play_game(player_0, player_1, game, verbose: bool = False) -> List[float]:
    """
    Play a game between two players.

    Args:
        player_0: Player for position 0
        player_1: Player for position 1
        game: PySpiel game object
        verbose: If True, print game progress

    Returns:
        List of returns for each player
    """
    state = game.new_initial_state()
    players = [player_0, player_1]

    while not state.is_terminal():
        current_player = state.current_player()
        if current_player < 0:
            break

        player = players[current_player]
        action = player.select_action(state, current_player)

        if verbose:
            action_str = state._action_to_string(current_player, action)
            print(f"Player {current_player}: {action_str}")

        state._apply_action(action)

    returns = state.returns()
    if verbose:
        print(f"Game over. Returns: {returns}")

    return returns


def evaluate_mcts_vs_random(
    network: "nn.Module",
    num_games: int = 100,
    mcts_iterations: int = 100,
    device: str = "cpu",
) -> dict:
    """
    Evaluate MCTS player against random opponent.

    Args:
        network: Neural network for MCTS
        num_games: Number of games to play
        mcts_iterations: MCTS iterations per decision
        device: Device for neural network

    Returns:
        Dict with win/loss/draw counts and win rate
    """
    import pyspiel
    import training.imposter_zero.game as _  # noqa: F401 - registers games

    game = pyspiel.load_game("imposter_zero_match")

    mcts_player = MCTSPlayer(
        network,
        num_iterations=mcts_iterations,
        temperature=0.3,  # Slightly greedy
        device=device,
    )
    random_player = RandomPlayer()

    mcts_wins = 0
    mcts_losses = 0
    draws = 0

    for i in range(num_games):
        # Alternate positions
        if i % 2 == 0:
            returns = play_game(mcts_player, random_player, game)
            mcts_return = returns[0]
        else:
            returns = play_game(random_player, mcts_player, game)
            mcts_return = returns[1]

        if mcts_return > 0:
            mcts_wins += 1
        elif mcts_return < 0:
            mcts_losses += 1
        else:
            draws += 1

    win_rate = mcts_wins / num_games if num_games > 0 else 0.0

    return {
        "wins": mcts_wins,
        "losses": mcts_losses,
        "draws": draws,
        "win_rate": win_rate,
        "games": num_games,
    }


if __name__ == "__main__":
    import argparse
    import json

    import pyspiel
    import torch

    import training.imposter_zero.game as _  # noqa: F401
    from train_ppo import ActorCritic, OBS_SIZE, NUM_ACTIONS

    parser = argparse.ArgumentParser(description="MCTS Player evaluation")
    parser.add_argument("--weights", type=str, help="Path to network weights JSON")
    parser.add_argument("--games", type=int, default=50, help="Number of games")
    parser.add_argument("--iterations", type=int, default=100, help="MCTS iterations")
    parser.add_argument("--device", type=str, default="cpu")
    args = parser.parse_args()

    # Load network
    net = ActorCritic(OBS_SIZE, 512, NUM_ACTIONS, num_layers=4)

    if args.weights:
        with open(args.weights, "r") as f:
            weights = json.load(f)
        state_dict = {}
        for key, val in weights.items():
            state_dict[key] = torch.tensor(val)
        net.load_state_dict(state_dict)

    net.to(args.device)
    net.eval()

    print(f"Evaluating MCTS ({args.iterations} iterations) vs Random...")
    results = evaluate_mcts_vs_random(
        net,
        num_games=args.games,
        mcts_iterations=args.iterations,
        device=args.device,
    )
    print(f"Results: {results}")
    print(f"Win rate: {results['win_rate']:.1%}")
